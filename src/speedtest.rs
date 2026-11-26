use std::collections::HashMap;
use std::convert::Infallible;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use futures_util::StreamExt;
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use jiff::civil::Date;
use jiff::Zoned;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::warn;

use crate::app::AppState;
use crate::auth::PeerIp;
use crate::config::SpeedtestConfig;
use crate::security::extract_client_ip;

const RANDOM_BUF_LEN: usize = 1024 * 1024; // 1 MiB incompressible random buffer
const UPLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_STREAM_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_TRACKED_SPEED_IPS: usize = 16_384;
const MAX_TRACKED_IP_SEMAPHORES: usize = 4_096;

struct DailyQuotaCounter {
    day: Date,
    used_bytes: u64,
}

fn current_local_date() -> Date {
    Zoned::now().date()
}

/// Speedtest backend state holding a 1 MiB incompressible buffer, per-IP rate limiters,
/// concurrency semaphores, and a local-date daily traffic quota.
pub struct SpeedtestService {
    cfg: SpeedtestConfig,
    random_chunk: Bytes,
    rate_limiter: DefaultKeyedRateLimiter<IpAddr>,
    global_sem: Arc<Semaphore>,
    ip_sems: Mutex<HashMap<IpAddr, Arc<Semaphore>>>,
    // minimal-debt: counter resets on process restart; persist to an atomic state file if strict cross-restart quota accounting is ever required
    daily_quota: Mutex<DailyQuotaCounter>,
}

impl SpeedtestService {
    pub fn new(cfg: &SpeedtestConfig) -> Self {
        let mut raw = vec![0u8; RANDOM_BUF_LEN];
        rand::rng().fill(&mut raw[..]);

        let rpm = NonZeroU32::new(cfg.per_ip_requests_per_minute.max(1)).unwrap();
        let quota = Quota::per_minute(rpm);

        Self {
            cfg: cfg.clone(),
            random_chunk: Bytes::from(raw),
            rate_limiter: RateLimiter::keyed(quota),
            global_sem: Arc::new(Semaphore::new(cfg.global_concurrency.max(1))),
            ip_sems: Mutex::new(HashMap::new()),
            daily_quota: Mutex::new(DailyQuotaCounter {
                day: current_local_date(),
                used_bytes: 0,
            }),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.cfg.enabled
    }

    pub fn max_upload_bytes(&self) -> u64 {
        self.cfg.max_upload_mb.saturating_mul(1024 * 1024)
    }

    pub fn max_download_bytes(&self) -> u64 {
        self.cfg.max_download_mb.saturating_mul(1024 * 1024)
    }

    fn daily_quota_limit_bytes(&self) -> u64 {
        self.cfg.daily_quota_gb.saturating_mul(1024 * 1024 * 1024)
    }

    /// Periodically evicts expired per-IP token buckets and idle concurrency semaphores.
    pub fn retain_recent(&self) {
        self.rate_limiter.retain_recent();
        self.rate_limiter.shrink_to_fit();

        if let Ok(mut map) = self.ip_sems.lock() {
            let cap = self.cfg.per_ip_concurrency;
            map.retain(|_, sem| Arc::strong_count(sem) > 1 || sem.available_permits() < cap);
            map.shrink_to_fit();
        }
    }

    pub fn check_rate_limit(&self, ip: IpAddr) -> bool {
        if self.rate_limiter.len() >= MAX_TRACKED_SPEED_IPS {
            self.rate_limiter.retain_recent();
            self.rate_limiter.shrink_to_fit();
            if self.rate_limiter.len() >= MAX_TRACKED_SPEED_IPS {
                return false;
            }
        }
        self.rate_limiter.check_key(&ip).is_ok()
    }

    pub fn try_acquire_concurrency(
        &self,
        ip: IpAddr,
    ) -> Option<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
        let ip_sem = {
            let mut map = self.ip_sems.lock().expect("ip_sems mutex poisoned");
            if let Some(existing) = map.get(&ip) {
                Arc::clone(existing)
            } else {
                if map.len() >= MAX_TRACKED_IP_SEMAPHORES {
                    let cap = self.cfg.per_ip_concurrency;
                    map.retain(|_, sem| {
                        Arc::strong_count(sem) > 1 || sem.available_permits() < cap
                    });
                    if map.len() >= MAX_TRACKED_IP_SEMAPHORES {
                        return None;
                    }
                }
                let created = Arc::new(Semaphore::new(self.cfg.per_ip_concurrency));
                map.insert(ip, Arc::clone(&created));
                created
            }
        };

        let ip_permit = ip_sem.try_acquire_owned().ok()?;
        let global_permit = Arc::clone(&self.global_sem).try_acquire_owned().ok()?;
        Some((ip_permit, global_permit))
    }

    /// Returns `true` when today's local-timezone traffic quota has been exhausted.
    pub fn is_quota_exhausted(&self) -> bool {
        let limit = self.daily_quota_limit_bytes();
        if limit == 0 {
            return false;
        }
        let today = current_local_date();
        let mut guard = self.daily_quota.lock().expect("daily_quota mutex poisoned");
        if guard.day != today {
            guard.day = today;
            guard.used_bytes = 0;
        }
        guard.used_bytes >= limit
    }

    /// Records `delta` transferred bytes and returns whether usage remains within today's quota.
    pub fn record_quota_bytes(&self, delta: u64) -> bool {
        let limit = self.daily_quota_limit_bytes();
        if limit == 0 {
            return true;
        }
        let today = current_local_date();
        let mut guard = self.daily_quota.lock().expect("daily_quota mutex poisoned");
        if guard.day != today {
            guard.day = today;
            guard.used_bytes = 0;
        }
        if guard.used_bytes >= limit {
            return false;
        }
        guard.used_bytes = guard.used_bytes.saturating_add(delta);
        true
    }

    /// Reserves download quota upfront before sending `200 OK`:
    /// - Returns `None` if quota is already exhausted (caller responds with `429` instead of truncating `Content-Length`);
    /// - Clamps `desired` to remaining quota bytes when less than `desired` remains;
    /// - Refunds any unstreamed bytes via `QuotaReservation::drop` if the client aborts early.
    pub fn reserve_download_quota(
        self: &Arc<Self>,
        desired: u64,
    ) -> Option<(u64, Option<QuotaReservation>)> {
        let limit = self.daily_quota_limit_bytes();
        if limit == 0 {
            return Some((desired, None));
        }
        let today = current_local_date();
        let mut guard = self.daily_quota.lock().expect("daily_quota mutex poisoned");
        if guard.day != today {
            guard.day = today;
            guard.used_bytes = 0;
        }
        if guard.used_bytes >= limit {
            return None;
        }
        let remaining = limit - guard.used_bytes;
        let granted = desired.min(remaining).max(1);
        guard.used_bytes = guard.used_bytes.saturating_add(granted);
        Some((
            granted,
            Some(QuotaReservation {
                svc: Arc::clone(self),
                unconsumed: granted,
            }),
        ))
    }

    fn refund_quota_bytes(&self, bytes: u64) {
        let today = current_local_date();
        if let Ok(mut guard) = self.daily_quota.lock() {
            if guard.day == today {
                guard.used_bytes = guard.used_bytes.saturating_sub(bytes);
            }
        }
    }
}

pub struct QuotaReservation {
    svc: Arc<SpeedtestService>,
    unconsumed: u64,
}

impl QuotaReservation {
    fn consume(&mut self, bytes: u64) {
        self.unconsumed = self.unconsumed.saturating_sub(bytes);
    }
}

impl Drop for QuotaReservation {
    fn drop(&mut self) {
        if self.unconsumed > 0 {
            self.svc.refund_quota_bytes(self.unconsumed);
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DownQuery {
    pub size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
    received_bytes: u64,
}

#[derive(Serialize)]
struct SpeedErrorBody {
    error: &'static str,
    message: &'static str,
}

fn error_json(
    status: StatusCode,
    retry_after_secs: Option<&'static str>,
    error: &'static str,
    message: &'static str,
) -> Response {
    let mut res = (
        status,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(SpeedErrorBody { error, message }),
    )
        .into_response();
    if let Some(secs) = retry_after_secs {
        res.headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static(secs));
    }
    res
}

/// `GET /api/speed/ping`
pub async fn get_ping(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    headers: HeaderMap,
) -> Response {
    let svc = &state.speedtest;
    if !svc.is_enabled() {
        return error_json(
            StatusCode::NOT_FOUND,
            None,
            "disabled",
            "Speedtest is disabled in configuration",
        );
    }

    let client_ip = extract_client_ip(peer_ip, &headers, &state.config.server.trusted_proxies);
    if !svc.check_rate_limit(client_ip) {
        warn!(client_ip = %client_ip, path = "/api/speed/ping", reason = "rate_limit", "speedtest ping hit per-IP rate limit");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("5"),
            "rate_limited",
            "Too many speedtest requests; please retry shortly",
        );
    }

    (
        StatusCode::OK,
        [(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, max-age=0"),
        )],
        "",
    )
        .into_response()
}

/// `GET /api/speed/down?size=<bytes>`
/// Streams uncompressed random bytes; concurrency permits are released automatically when the response stream ends.
pub async fn get_down(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    headers: HeaderMap,
    Query(query): Query<DownQuery>,
) -> Response {
    let svc = &state.speedtest;
    if !svc.is_enabled() {
        return error_json(
            StatusCode::NOT_FOUND,
            None,
            "disabled",
            "Speedtest is disabled in configuration",
        );
    }

    let client_ip = extract_client_ip(peer_ip, &headers, &state.config.server.trusted_proxies);
    if !svc.check_rate_limit(client_ip) {
        warn!(client_ip = %client_ip, path = "/api/speed/down", reason = "rate_limit", "speedtest download hit per-IP rate limit");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("5"),
            "rate_limited",
            "Too many speedtest requests; please retry shortly",
        );
    }

    if svc.is_quota_exhausted() {
        warn!(client_ip = %client_ip, path = "/api/speed/down", reason = "daily_quota", "speedtest download hit daily traffic quota");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3600"),
            "quota_exceeded",
            "Daily speedtest traffic quota exhausted",
        );
    }

    let Some(permits) = svc.try_acquire_concurrency(client_ip) else {
        warn!(client_ip = %client_ip, path = "/api/speed/down", reason = "concurrency", "speedtest download hit concurrency cap");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3"),
            "concurrency_limited",
            "Maximum concurrent speedtest streams reached",
        );
    };

    let max_bytes = svc.max_download_bytes();
    let requested_bytes = query.size.unwrap_or(max_bytes).clamp(1, max_bytes);
    let Some((target_bytes, quota_reservation)) = svc.reserve_download_quota(requested_bytes)
    else {
        warn!(client_ip = %client_ip, path = "/api/speed/down", reason = "daily_quota", "speedtest download hit daily traffic quota");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3600"),
            "quota_exceeded",
            "Daily speedtest traffic quota exhausted",
        );
    };

    let chunk_template = svc.random_chunk.clone();
    let started_at = Instant::now();

    let stream = futures_util::stream::unfold(
        (
            target_bytes,
            chunk_template,
            quota_reservation,
            permits,
            started_at,
        ),
        |(remaining, buf, mut reservation, held_permits, t0)| async move {
            if remaining == 0 || t0.elapsed() >= DOWNLOAD_STREAM_TIMEOUT {
                return None;
            }
            let step = remaining.min(buf.len() as u64) as usize;
            if let Some(resv) = reservation.as_mut() {
                resv.consume(step as u64);
            }
            let slice = buf.slice(0..step);
            Some((
                Ok::<Bytes, Infallible>(slice),
                (remaining - step as u64, buf, reservation, held_permits, t0),
            ))
        },
    );

    let mut res = Response::new(Body::from_stream(stream));
    *res.status_mut() = StatusCode::OK;
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, max-age=0, no-transform"),
    );
    if let Ok(cl) = HeaderValue::from_str(&target_bytes.to_string()) {
        h.insert(header::CONTENT_LENGTH, cl);
    }
    res
}

/// `POST /api/speed/up`
/// Counts streamed request body bytes and discards each chunk immediately in memory (zero disk writes);
/// returns `413 Payload Too Large` as soon as `max_upload_mb` is exceeded.
pub async fn post_up(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    req: Request,
) -> Response {
    let svc = &state.speedtest;
    if !svc.is_enabled() {
        return error_json(
            StatusCode::NOT_FOUND,
            None,
            "disabled",
            "Speedtest is disabled in configuration",
        );
    }

    let client_ip = extract_client_ip(peer_ip, req.headers(), &state.config.server.trusted_proxies);

    if !svc.check_rate_limit(client_ip) {
        warn!(client_ip = %client_ip, path = "/api/speed/up", reason = "rate_limit", "speedtest upload hit per-IP rate limit");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("5"),
            "rate_limited",
            "Too many speedtest requests; please retry shortly",
        );
    }

    if svc.is_quota_exhausted() {
        warn!(client_ip = %client_ip, path = "/api/speed/up", reason = "daily_quota", "speedtest upload hit daily traffic quota");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3600"),
            "quota_exceeded",
            "Daily speedtest traffic quota exhausted",
        );
    }

    let Some(_permits) = svc.try_acquire_concurrency(client_ip) else {
        warn!(client_ip = %client_ip, path = "/api/speed/up", reason = "concurrency", "speedtest upload hit concurrency cap");
        return error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3"),
            "concurrency_limited",
            "Maximum concurrent speedtest streams reached",
        );
    };

    let max_bytes = svc.max_upload_bytes();
    if let Some(cl) = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        if cl > max_bytes {
            warn!(client_ip = %client_ip, path = "/api/speed/up", content_length = cl, "speedtest upload Content-Length exceeded cap");
            return error_json(
                StatusCode::PAYLOAD_TOO_LARGE,
                None,
                "payload_too_large",
                "Upload payload exceeds configured limit",
            );
        }
    }

    let mut body_stream = req.into_body().into_data_stream();
    let mut received: u64 = 0;

    let read_res = tokio::time::timeout(UPLOAD_READ_TIMEOUT, async {
        while let Some(frame_res) = body_stream.next().await {
            let chunk = frame_res.map_err(|_| StatusCode::BAD_REQUEST)?;
            let len = chunk.len() as u64;
            // Chunk is dropped immediately at the end of this iteration without buffering or disk writes
            received = received.saturating_add(len);
            if received > max_bytes {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            if !svc.record_quota_bytes(len) {
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
        }
        Ok(())
    })
    .await;

    match read_res {
        Err(_) => error_json(
            StatusCode::REQUEST_TIMEOUT,
            None,
            "timeout",
            "Upload stream read timed out",
        ),
        Ok(Err(StatusCode::PAYLOAD_TOO_LARGE)) => {
            warn!(client_ip = %client_ip, path = "/api/speed/up", received, "speedtest upload stream exceeded cap");
            error_json(
                StatusCode::PAYLOAD_TOO_LARGE,
                None,
                "payload_too_large",
                "Upload payload exceeds configured limit",
            )
        }
        Ok(Err(StatusCode::TOO_MANY_REQUESTS)) => error_json(
            StatusCode::TOO_MANY_REQUESTS,
            Some("3600"),
            "quota_exceeded",
            "Daily speedtest traffic quota exhausted",
        ),
        Ok(Err(_)) => error_json(
            StatusCode::BAD_REQUEST,
            None,
            "bad_stream",
            "Upload stream interrupted",
        ),
        Ok(Ok(())) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(UploadResponse {
                received_bytes: received,
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_quota_reservation_clamps_and_refunds_unconsumed_bytes() {
        let cfg = SpeedtestConfig {
            enabled: true,
            max_upload_mb: 16,
            max_download_mb: 64,
            per_ip_concurrency: 4,
            global_concurrency: 8,
            per_ip_requests_per_minute: 60,
            daily_quota_gb: 1,
        };
        let svc = Arc::new(SpeedtestService::new(&cfg));
        let gib = 1024 * 1024 * 1024_u64;

        // Consume quota until only 10 MiB remain
        assert!(svc.record_quota_bytes(gib - 10 * 1024 * 1024));

        // Requesting 32 MiB clamps to the remaining 10 MiB and locks the quota while the stream is active
        let (granted, mut resv) = svc
            .reserve_download_quota(32 * 1024 * 1024)
            .expect("should grant remaining 10 MiB");
        assert_eq!(granted, 10 * 1024 * 1024);
        assert!(svc.reserve_download_quota(1024).is_none());

        // Stream aborts after sending 4 MiB; the unconsumed 6 MiB are refunded on drop
        resv.as_mut().unwrap().consume(4 * 1024 * 1024);
        drop(resv);

        let (granted_after_refund, _resv2) = svc
            .reserve_download_quota(16 * 1024 * 1024)
            .expect("6 MiB should have been refunded");
        assert_eq!(granted_after_refund, 6 * 1024 * 1024);
    }
}
