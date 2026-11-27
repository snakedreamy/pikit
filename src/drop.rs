use std::collections::HashMap;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, OwnedSemaphorePermit, Semaphore};
use tracing::warn;

use crate::app::AppState;
use crate::auth::PeerIp;
use crate::config::DropConfig;
use crate::security::{extract_client_ip, is_same_origin_api_request, IpNet};

/// Maximum JSON signaling text frame size (32 KiB).
pub const MAX_CONTROL_TEXT_BYTES: usize = 32 * 1024;
/// Maximum encrypted binary chunk frame size (64 KiB).
pub const MAX_RELAY_BINARY_BYTES: usize = 64 * 1024;
/// Plaintext slice per `/drop` chunk frame (`64 KiB - 64 B` = `65,472 B`), matching `DROP_CHUNK_PLAINTEXT_BYTES`.
const DROP_CHUNK_PLAINTEXT_BYTES: u64 = 64 * 1024 - 64;
/// Per-chunk AEAD wire overhead (`9 B` frame header + `16 B` ChaCha20-Poly1305 tag).
const DROP_CHUNK_WIRE_OVERHEAD_BYTES: u64 = 9 + 16;
/// Fixed wire allowance covering the encrypted `META` and `EOF` control frames so exact `max_relay_mb` files complete cleanly.
const DROP_ENVELOPE_WIRE_ALLOWANCE_BYTES: u64 = 4096;
/// Per-peer cumulative signaling text cap to prevent abusing JSON frames as an unbounded data channel.
const MAX_TOTAL_CONTROL_BYTES: usize = 256 * 1024;
/// Bounded per-direction channel depth (~1 MiB worst-case per direction at 64 KiB/frame) for TCP backpressure.
const RELAY_CHANNEL_CAPACITY: usize = 16;
/// Initial command deadline after WebSocket upgrade so idle sockets (even sending Ping frames) cannot hold connections open.
const INITIAL_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
/// Per-frame socket/channel write deadline so zero-window stalled peers cannot hold room permits indefinitely.
const SEND_FRAME_TIMEOUT: Duration = Duration::from_secs(10);
const PAIRED_SEND_TIMEOUT: Duration = Duration::from_secs(30);
/// Paired session idle timeout when neither signaling nor ciphertext frames flow (Ping/Pong does not extend this timer).
const PAIRED_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
/// Hard wall-clock ceiling for any paired session.
const MAX_PAIRED_SESSION_DURATION: Duration = Duration::from_secs(1800);
const MAX_TRACKED_DROP_IPS: usize = 16_384;

struct WaitingRoom {
    expires_at: Instant,
    sender_pub_key: String,
    sender_salt: String,
    join_tx: oneshot::Sender<JoinedPeerBundle>,
    room_permit: OwnedSemaphorePermit,
}

struct JoinedPeerBundle {
    receiver_pub_key: String,
    receiver_salt: String,
    tx_to_peer: mpsc::Sender<RelayFrame>,
    rx_from_peer: mpsc::Receiver<RelayFrame>,
    relay_bytes: Arc<AtomicU64>,
    shared_permit: Arc<OwnedSemaphorePermit>,
}

enum RelayFrame {
    Text(Utf8Bytes),
    Binary(Bytes),
    Abort,
}

/// Ephemeral zero-storage pairing & ciphertext relay service for `/drop`.
/// Never stores plaintext, metadata, or files, and never logs pairing codes or signaling payloads.
pub struct DropService {
    cfg: DropConfig,
    rate_limiter: DefaultKeyedRateLimiter<IpAddr>,
    handshake_sem: Arc<Semaphore>,
    room_sem: Arc<Semaphore>,
    rooms: Mutex<HashMap<String, WaitingRoom>>,
}

impl DropService {
    pub fn new(cfg: &DropConfig) -> Self {
        let rpm = NonZeroU32::new(cfg.per_ip_requests_per_minute.max(1)).unwrap();
        let quota = Quota::per_minute(rpm);
        let max_rooms = cfg.max_rooms.max(1);

        Self {
            cfg: cfg.clone(),
            rate_limiter: RateLimiter::keyed(quota),
            handshake_sem: Arc::new(Semaphore::new(max_rooms.saturating_mul(2).max(16))),
            room_sem: Arc::new(Semaphore::new(max_rooms)),
            rooms: Mutex::new(HashMap::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.cfg.enabled
    }

    /// Computes the exact maximum wire ciphertext budget for a configured `max_relay_mb` payload limit,
    /// including per-chunk AEAD headers/tags and the `META` + `EOF` frame envelope.
    pub fn max_relay_bytes(&self) -> u64 {
        let max_plain = self.cfg.max_relay_mb.saturating_mul(1024 * 1024);
        let max_chunks = max_plain.div_ceil(DROP_CHUNK_PLAINTEXT_BYTES);
        max_plain
            .saturating_add(max_chunks.saturating_mul(DROP_CHUNK_WIRE_OVERHEAD_BYTES))
            .saturating_add(DROP_ENVELOPE_WIRE_ALLOWANCE_BYTES)
    }

    /// Evicts expired waiting rooms and stale per-IP rate-limiter buckets.
    pub fn retain_recent(&self) {
        self.rate_limiter.retain_recent();
        self.rate_limiter.shrink_to_fit();

        let now = Instant::now();
        if let Ok(mut guard) = self.rooms.lock() {
            guard.retain(|_, room| room.expires_at > now);
            guard.shrink_to_fit();
        }
    }

    pub fn check_rate_limit(&self, ip: IpAddr) -> bool {
        if self.rate_limiter.len() >= MAX_TRACKED_DROP_IPS {
            self.rate_limiter.retain_recent();
            self.rate_limiter.shrink_to_fit();
            if self.rate_limiter.len() >= MAX_TRACKED_DROP_IPS {
                return false;
            }
        }
        self.rate_limiter.check_key(&ip).is_ok()
    }

    fn create_waiting_room(
        &self,
        sender_pub_key: String,
        sender_salt: String,
    ) -> Option<(String, Instant, oneshot::Receiver<JoinedPeerBundle>)> {
        let now = Instant::now();
        {
            let mut guard = self.rooms.lock().expect("drop rooms mutex poisoned");
            guard.retain(|_, room| room.expires_at > now);
        }

        let room_permit = Arc::clone(&self.room_sem).try_acquire_owned().ok()?;
        let ttl = Duration::from_secs(self.cfg.code_ttl_seconds);
        let expires_at = now + ttl;
        let (join_tx, join_rx) = oneshot::channel();

        let mut guard = self.rooms.lock().expect("drop rooms mutex poisoned");
        let mut selected_code: Option<String> = None;
        for _ in 0..64 {
            let num: u32 = rand::rng().random_range(0..1_000_000);
            let candidate = format!("{num:06}");
            if !guard.contains_key(&candidate) {
                selected_code = Some(candidate);
                break;
            }
        }
        let code = selected_code?;

        guard.insert(
            code.clone(),
            WaitingRoom {
                expires_at,
                sender_pub_key,
                sender_salt,
                join_tx,
                room_permit,
            },
        );

        Some((code, expires_at, join_rx))
    }

    fn remove_waiting_room(&self, code: &str) {
        if let Ok(mut guard) = self.rooms.lock() {
            guard.remove(code);
        }
    }

    /// Atomically claims and removes a waiting room on the very first join lookup.
    /// Guarantees strictly single-attempt pairing: even if subsequent E2EE MAC confirmation fails,
    /// the 6-digit code is already gone from the table and cannot be retried.
    fn claim_waiting_room(&self, code: &str) -> Option<WaitingRoom> {
        let now = Instant::now();
        let mut guard = self.rooms.lock().expect("drop rooms mutex poisoned");
        let room = guard.remove(code)?;
        if room.expires_at <= now {
            return None;
        }
        Some(room)
    }
}

#[derive(Serialize)]
struct DropErrorHttpBody {
    error: &'static str,
    message: &'static str,
}

fn http_error(
    status: StatusCode,
    retry_after: Option<&'static str>,
    error: &'static str,
    message: &'static str,
) -> Response {
    let mut res = (
        status,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(DropErrorHttpBody { error, message }),
    )
        .into_response();
    if let Some(secs) = retry_after {
        res.headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static(secs));
    }
    res
}

fn has_mandatory_same_origin(
    peer_ip: IpAddr,
    headers: &HeaderMap,
    uri_authority: Option<&str>,
    trusted_proxies: &[IpNet],
) -> bool {
    if !headers.contains_key(header::ORIGIN) {
        return false;
    }
    is_same_origin_api_request(peer_ip, headers, uri_authority, trusted_proxies)
}

/// `GET /api/drop/ws`
/// Enforces feature switch, mandatory same-origin `Origin` header (CSWSH protection), per-IP token bucket,
/// and 64 KiB WebSocket frame limits before upgrading.
pub async fn get_drop_ws(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    uri: Uri,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let svc = &state.drop;
    if !svc.is_enabled() {
        return http_error(
            StatusCode::NOT_FOUND,
            None,
            "disabled",
            "Encrypted drop is disabled in configuration",
        );
    }

    let client_ip = extract_client_ip(peer_ip, &headers, &state.config.server.trusted_proxies);

    if !has_mandatory_same_origin(
        peer_ip,
        &headers,
        uri.authority().map(|a| a.as_str()),
        &state.config.server.trusted_proxies,
    ) {
        warn!(
            client_ip = %client_ip,
            path = "/api/drop/ws",
            "rejected WebSocket upgrade with missing or cross-origin Origin header"
        );
        return http_error(
            StatusCode::FORBIDDEN,
            None,
            "forbidden_origin",
            "Same-origin Origin header is required for WebSocket upgrade",
        );
    }

    if !svc.check_rate_limit(client_ip) {
        warn!(
            client_ip = %client_ip,
            path = "/api/drop/ws",
            "drop WebSocket handshake hit per-IP rate limit"
        );
        return http_error(
            StatusCode::TOO_MANY_REQUESTS,
            Some("10"),
            "rate_limited",
            "Too many pairing attempts; please wait shortly",
        );
    }

    let Ok(handshake_permit) = Arc::clone(&svc.handshake_sem).try_acquire_owned() else {
        return http_error(
            StatusCode::TOO_MANY_REQUESTS,
            Some("5"),
            "rooms_full",
            "Maximum concurrent pairing handshakes reached; please try again shortly",
        );
    };

    let ws = match ws {
        Ok(upgrade) => upgrade,
        Err(rejection) => return rejection.into_response(),
    };

    let drop_svc = Arc::clone(&state.drop);
    ws.max_message_size(MAX_RELAY_BINARY_BYTES)
        .max_frame_size(MAX_RELAY_BINARY_BYTES)
        .on_upgrade(move |socket| handle_drop_socket(socket, drop_svc, client_ip, handshake_permit))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum InitialClientCommand {
    #[serde(rename_all = "camelCase")]
    Create { pub_key: String, salt: String },
    #[serde(rename_all = "camelCase")]
    Join {
        code: String,
        pub_key: String,
        salt: String,
    },
}

#[derive(Deserialize)]
struct PairedControlEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerControlMessage<'a> {
    #[serde(rename_all = "camelCase")]
    Created {
        code: &'a str,
        ttl_seconds: u64,
        max_relay_mb: u64,
    },
    #[serde(rename_all = "camelCase")]
    PeerJoined {
        pub_key: &'a str,
        salt: &'a str,
    },
    #[serde(rename_all = "camelCase")]
    Joined {
        pub_key: &'a str,
        salt: &'a str,
        max_relay_mb: u64,
    },
    PeerDisconnected,
    Error {
        code: &'static str,
        message: &'static str,
    },
}

fn is_valid_b64_token(s: &str, min_len: usize, max_len: usize) -> bool {
    let len = s.len();
    if len < min_len || len > max_len {
        return false;
    }
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'+' | b'/' | b'='))
}

fn is_valid_six_digit_code(s: &str) -> bool {
    s.len() == 6 && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_allowed_paired_control_type(msg_type: &str) -> bool {
    matches!(
        msg_type,
        "key_confirm"
            | "rtc_offer"
            | "rtc_answer"
            | "rtc_ice"
            | "transport_mode"
            | "done"
            | "abort"
    )
}

async fn send_ws_bounded(
    socket: &mut WebSocket,
    msg: Message,
    timeout_dur: Duration,
) -> Result<(), ()> {
    tokio::time::timeout(timeout_dur, socket.send(msg))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

async fn send_server_json(
    socket: &mut WebSocket,
    msg: &ServerControlMessage<'_>,
) -> Result<(), ()> {
    let text = serde_json::to_string(msg).map_err(|_| ())?;
    send_ws_bounded(socket, Message::Text(text.into()), SEND_FRAME_TIMEOUT).await
}

async fn send_error_and_close(socket: &mut WebSocket, code: &'static str, message: &'static str) {
    let _ = send_server_json(socket, &ServerControlMessage::Error { code, message }).await;
    let _ = send_ws_bounded(socket, Message::Close(None), Duration::from_secs(3)).await;
}

async fn read_initial_command_with_timeout(
    socket: &mut WebSocket,
    total_timeout: Duration,
) -> Result<InitialClientCommand, (&'static str, &'static str)> {
    let deadline = tokio::time::Instant::now() + total_timeout;
    tokio::time::timeout_at(deadline, async {
        loop {
            match socket.recv().await {
                Some(Ok(Message::Text(txt))) => {
                    if txt.len() > MAX_CONTROL_TEXT_BYTES {
                        return Err(("frame_too_large", "Control message exceeds 32 KiB limit"));
                    }
                    return serde_json::from_str::<InitialClientCommand>(txt.as_str())
                        .map_err(|_| ("bad_command", "Invalid initial pairing command"));
                }
                Some(Ok(Message::Ping(p))) => {
                    if send_ws_bounded(socket, Message::Pong(p), SEND_FRAME_TIMEOUT)
                        .await
                        .is_err()
                    {
                        return Err(("closed", "Connection closed"));
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Binary(_))) => {
                    return Err((
                        "unexpected_binary",
                        "Binary frames are not allowed before pairing completes",
                    ));
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err(("closed", "Connection closed"));
                }
                Some(Err(_)) => {
                    return Err(("frame_too_large", "WebSocket frame rejected"));
                }
            }
        }
    })
    .await
    .unwrap_or(Err((
        "handshake_timeout",
        "Timed out waiting for initial pairing command",
    )))
}

async fn handle_drop_socket(
    mut socket: WebSocket,
    svc: Arc<DropService>,
    client_ip: IpAddr,
    handshake_permit: OwnedSemaphorePermit,
) {
    let cmd = match read_initial_command_with_timeout(&mut socket, INITIAL_COMMAND_TIMEOUT).await {
        Ok(c) => c,
        Err(("closed", _)) => return,
        Err((code, msg)) => {
            send_error_and_close(&mut socket, code, msg).await;
            return;
        }
    };
    drop(handshake_permit);

    match cmd {
        InitialClientCommand::Create { pub_key, salt } => {
            if !is_valid_b64_token(&pub_key, 40, 64) || !is_valid_b64_token(&salt, 20, 64) {
                send_error_and_close(
                    &mut socket,
                    "invalid_key_material",
                    "Invalid ephemeral public key or salt encoding",
                )
                .await;
                return;
            }

            let Some((code, expires_at, mut join_rx)) = svc.create_waiting_room(pub_key, salt)
            else {
                warn!(
                    client_ip = %client_ip,
                    "drop room allocation rejected because max_rooms is full"
                );
                send_error_and_close(
                    &mut socket,
                    "rooms_full",
                    "Maximum concurrent pairing rooms reached; please try again shortly",
                )
                .await;
                return;
            };

            if send_server_json(
                &mut socket,
                &ServerControlMessage::Created {
                    code: &code,
                    ttl_seconds: svc.cfg.code_ttl_seconds,
                    max_relay_mb: svc.cfg.max_relay_mb,
                },
            )
            .await
            .is_err()
            {
                svc.remove_waiting_room(&code);
                return;
            }

            let joined = loop {
                tokio::select! {
                    res = &mut join_rx => {
                        match res {
                            Ok(bundle) => break bundle,
                            Err(_) => {
                                svc.remove_waiting_room(&code);
                                send_error_and_close(&mut socket, "cancelled", "Pairing room closed").await;
                                return;
                            }
                        }
                    }
                    _ = tokio::time::sleep_until(expires_at.into()) => {
                        svc.remove_waiting_room(&code);
                        send_error_and_close(&mut socket, "expired", "Pairing code expired").await;
                        return;
                    }
                    incoming = socket.recv() => {
                        match incoming {
                            Some(Ok(Message::Ping(p))) => {
                                if send_ws_bounded(&mut socket, Message::Pong(p), SEND_FRAME_TIMEOUT)
                                    .await
                                    .is_err()
                                {
                                    svc.remove_waiting_room(&code);
                                    return;
                                }
                            }
                            Some(Ok(Message::Pong(_))) => {}
                            _ => {
                                // Sender cancelled, disconnected, or sent an unexpected frame before pairing: destroy room immediately
                                svc.remove_waiting_room(&code);
                                let _ = send_ws_bounded(&mut socket, Message::Close(None), Duration::from_secs(3)).await;
                                return;
                            }
                        }
                    }
                }
            };

            if send_server_json(
                &mut socket,
                &ServerControlMessage::PeerJoined {
                    pub_key: &joined.receiver_pub_key,
                    salt: &joined.receiver_salt,
                },
            )
            .await
            .is_err()
            {
                return;
            }

            pump_paired_session(
                socket,
                joined.tx_to_peer,
                joined.rx_from_peer,
                joined.relay_bytes,
                svc.max_relay_bytes(),
                joined.shared_permit,
            )
            .await;
        }
        InitialClientCommand::Join {
            code,
            pub_key,
            salt,
        } => {
            if !is_valid_six_digit_code(&code)
                || !is_valid_b64_token(&pub_key, 40, 64)
                || !is_valid_b64_token(&salt, 20, 64)
            {
                send_error_and_close(
                    &mut socket,
                    "invalid_or_expired",
                    "Invalid or expired pairing code",
                )
                .await;
                return;
            }

            let Some(room) = svc.claim_waiting_room(&code) else {
                send_error_and_close(
                    &mut socket,
                    "invalid_or_expired",
                    "Invalid or expired pairing code",
                )
                .await;
                return;
            };

            let (s2r_tx, s2r_rx) = mpsc::channel::<RelayFrame>(RELAY_CHANNEL_CAPACITY);
            let (r2s_tx, r2s_rx) = mpsc::channel::<RelayFrame>(RELAY_CHANNEL_CAPACITY);
            let relay_bytes = Arc::new(AtomicU64::new(0));
            let shared_permit = Arc::new(room.room_permit);

            let bundle_for_sender = JoinedPeerBundle {
                receiver_pub_key: pub_key,
                receiver_salt: salt,
                tx_to_peer: s2r_tx,
                rx_from_peer: r2s_rx,
                relay_bytes: Arc::clone(&relay_bytes),
                shared_permit: Arc::clone(&shared_permit),
            };

            if room.join_tx.send(bundle_for_sender).is_err() {
                send_error_and_close(
                    &mut socket,
                    "invalid_or_expired",
                    "Sender disconnected before pairing completed",
                )
                .await;
                return;
            }

            if send_server_json(
                &mut socket,
                &ServerControlMessage::Joined {
                    pub_key: &room.sender_pub_key,
                    salt: &room.sender_salt,
                    max_relay_mb: svc.cfg.max_relay_mb,
                },
            )
            .await
            .is_err()
            {
                return;
            }

            pump_paired_session(
                socket,
                r2s_tx,
                s2r_rx,
                relay_bytes,
                svc.max_relay_bytes(),
                shared_permit,
            )
            .await;
        }
    }
}

async fn pump_paired_session(
    mut socket: WebSocket,
    tx_to_peer: mpsc::Sender<RelayFrame>,
    mut rx_from_peer: mpsc::Receiver<RelayFrame>,
    relay_bytes: Arc<AtomicU64>,
    max_relay_bytes: u64,
    _held_room_permit: Arc<OwnedSemaphorePermit>,
) {
    let mut control_bytes_sent: usize = 0;
    let session_ceiling = tokio::time::Instant::now() + MAX_PAIRED_SESSION_DURATION;
    let mut idle_deadline =
        (tokio::time::Instant::now() + PAIRED_IDLE_TIMEOUT).min(session_ceiling);

    loop {
        tokio::select! {
            outbound = rx_from_peer.recv() => {
                match outbound {
                    Some(RelayFrame::Text(txt)) => {
                        idle_deadline = (tokio::time::Instant::now() + PAIRED_IDLE_TIMEOUT).min(session_ceiling);
                        if send_ws_bounded(&mut socket, Message::Text(txt), PAIRED_SEND_TIMEOUT).await.is_err() {
                            break;
                        }
                    }
                    Some(RelayFrame::Binary(bin)) => {
                        idle_deadline = (tokio::time::Instant::now() + PAIRED_IDLE_TIMEOUT).min(session_ceiling);
                        if send_ws_bounded(&mut socket, Message::Binary(bin), PAIRED_SEND_TIMEOUT).await.is_err() {
                            break;
                        }
                    }
                    Some(RelayFrame::Abort) => {
                        send_error_and_close(
                            &mut socket,
                            "aborted",
                            "Session terminated by peer verification failure or cancellation",
                        ).await;
                        break;
                    }
                    None => {
                        let _ = send_server_json(&mut socket, &ServerControlMessage::PeerDisconnected).await;
                        let _ = send_ws_bounded(&mut socket, Message::Close(None), Duration::from_secs(3)).await;
                        break;
                    }
                }
            }
            inbound = tokio::time::timeout_at(idle_deadline, socket.recv()) => {
                match inbound {
                    Err(_) => {
                        let _ = tx_to_peer.try_send(RelayFrame::Abort);
                        send_error_and_close(&mut socket, "idle_timeout", "Pairing session timed out due to inactivity").await;
                        break;
                    }
                    Ok(Some(Ok(Message::Text(txt)))) => {
                        idle_deadline = (tokio::time::Instant::now() + PAIRED_IDLE_TIMEOUT).min(session_ceiling);
                        if txt.len() > MAX_CONTROL_TEXT_BYTES {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(&mut socket, "frame_too_large", "Control message exceeds 32 KiB limit").await;
                            break;
                        }
                        control_bytes_sent = control_bytes_sent.saturating_add(txt.len());
                        if control_bytes_sent > MAX_TOTAL_CONTROL_BYTES {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(&mut socket, "control_quota_exceeded", "Signaling quota exceeded for session").await;
                            break;
                        }
                        let Ok(env) = serde_json::from_str::<PairedControlEnvelope>(txt.as_str()) else {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(&mut socket, "bad_command", "Malformed signaling message").await;
                            break;
                        };
                        if !is_allowed_paired_control_type(&env.msg_type) {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(&mut socket, "bad_command", "Unsupported signaling message type").await;
                            break;
                        }
                        if env.msg_type == "abort" {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            let _ = send_ws_bounded(&mut socket, Message::Close(None), Duration::from_secs(3)).await;
                            break;
                        }
                        if tokio::time::timeout(PAIRED_SEND_TIMEOUT, tx_to_peer.send(RelayFrame::Text(txt)))
                            .await
                            .map_or(true, |r| r.is_err())
                        {
                            break;
                        }
                    }
                    Ok(Some(Ok(Message::Binary(bin)))) => {
                        idle_deadline = (tokio::time::Instant::now() + PAIRED_IDLE_TIMEOUT).min(session_ceiling);
                        if bin.is_empty() || bin.len() > MAX_RELAY_BINARY_BYTES {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(&mut socket, "frame_too_large", "Ciphertext chunk must be 1..=65536 bytes").await;
                            break;
                        }
                        let prev = relay_bytes.fetch_add(bin.len() as u64, Ordering::Relaxed);
                        if prev.saturating_add(bin.len() as u64) > max_relay_bytes {
                            let _ = tx_to_peer.try_send(RelayFrame::Abort);
                            send_error_and_close(
                                &mut socket,
                                "relay_limit_exceeded",
                                "Session ciphertext relay limit exceeded",
                            ).await;
                            break;
                        }
                        // Bounded mpsc `.send().await` with write deadline propagates natural TCP window backpressure
                        // while ensuring a stalled receiver cannot hold room permits open indefinitely.
                        if tokio::time::timeout(PAIRED_SEND_TIMEOUT, tx_to_peer.send(RelayFrame::Binary(bin)))
                            .await
                            .map_or(true, |r| r.is_err())
                        {
                            break;
                        }
                    }
                    Ok(Some(Ok(Message::Ping(p)))) => {
                        if send_ws_bounded(&mut socket, Message::Pong(p), SEND_FRAME_TIMEOUT).await.is_err() {
                            break;
                        }
                    }
                    Ok(Some(Ok(Message::Pong(_)))) => {}
                    Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                        break;
                    }
                    Ok(Some(Err(_))) => {
                        let _ = tx_to_peer.try_send(RelayFrame::Abort);
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::body::Body;
    use axum::http::Request;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tower::ServiceExt;

    use super::*;
    use crate::app::build_router;
    use crate::config::Config;

    struct MiniWsClient {
        stream: TcpStream,
    }

    impl MiniWsClient {
        async fn connect(
            addr: SocketAddr,
            origin: Option<&str>,
            cookie: Option<&str>,
        ) -> Result<Self, u16> {
            let mut stream = TcpStream::connect(addr).await.unwrap();
            let mut req = format!(
                "GET /api/drop/ws HTTP/1.1\r\n\
                 Host: 127.0.0.1:{}\r\n\
                 Upgrade: websocket\r\n\
                 Connection: Upgrade\r\n\
                 Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                 Sec-WebSocket-Version: 13\r\n",
                addr.port()
            );
            if let Some(orig) = origin {
                req.push_str(&format!("Origin: {orig}\r\n"));
            }
            if let Some(ck) = cookie {
                req.push_str(&format!("Cookie: {ck}\r\n"));
            }
            req.push_str("\r\n");
            stream.write_all(req.as_bytes()).await.unwrap();

            let mut header_buf = Vec::with_capacity(512);
            let mut byte = [0u8; 1];
            while !header_buf.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).await.unwrap();
                header_buf.push(byte[0]);
            }
            let head = String::from_utf8_lossy(&header_buf);
            let status_code: u16 = head
                .lines()
                .next()
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap()
                .parse()
                .unwrap();
            if status_code != 101 {
                return Err(status_code);
            }
            Ok(Self { stream })
        }

        async fn send_frame(&mut self, opcode: u8, payload: &[u8]) {
            let mask_key = [0x12u8, 0x34, 0x56, 0x78];
            let mut header = Vec::with_capacity(14);
            header.push(0x80 | opcode);
            if payload.len() < 126 {
                header.push(0x80 | (payload.len() as u8));
            } else if payload.len() <= 65535 {
                header.push(0x80 | 126);
                header.extend_from_slice(&(payload.len() as u16).to_be_bytes());
            } else {
                header.push(0x80 | 127);
                header.extend_from_slice(&(payload.len() as u64).to_be_bytes());
            }
            header.extend_from_slice(&mask_key);
            let mut masked = payload.to_vec();
            for (i, b) in masked.iter_mut().enumerate() {
                *b ^= mask_key[i % 4];
            }
            self.stream.write_all(&header).await.unwrap();
            self.stream.write_all(&masked).await.unwrap();
        }

        async fn send_text(&mut self, text: &str) {
            self.send_frame(0x1, text.as_bytes()).await;
        }

        async fn send_binary(&mut self, data: &[u8]) {
            self.send_frame(0x2, data).await;
        }

        async fn recv_frame(&mut self) -> Option<(u8, Vec<u8>)> {
            let mut first2 = [0u8; 2];
            if self.stream.read_exact(&mut first2).await.is_err() {
                return None;
            }
            let opcode = first2[0] & 0x0f;
            let masked = (first2[1] & 0x80) != 0;
            let mut len = (first2[1] & 0x7f) as usize;
            if len == 126 {
                let mut ext = [0u8; 2];
                self.stream.read_exact(&mut ext).await.ok()?;
                len = u16::from_be_bytes(ext) as usize;
            } else if len == 127 {
                let mut ext = [0u8; 8];
                self.stream.read_exact(&mut ext).await.ok()?;
                len = u64::from_be_bytes(ext) as usize;
            }
            let mut mask = [0u8; 4];
            if masked {
                self.stream.read_exact(&mut mask).await.ok()?;
            }
            let mut payload = vec![0u8; len];
            self.stream.read_exact(&mut payload).await.ok()?;
            if masked {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask[i % 4];
                }
            }
            Some((opcode, payload))
        }

        async fn recv_json(&mut self) -> serde_json::Value {
            loop {
                let (opcode, payload) = self.recv_frame().await.expect("expected WS frame");
                if opcode == 0x1 {
                    return serde_json::from_slice(&payload).unwrap();
                }
            }
        }
    }

    async fn spawn_test_server(toml_cfg: &str) -> (SocketAddr, AppState) {
        let cfg = Config::from_toml_str(toml_cfg).unwrap();
        let state = AppState::new(Arc::new(cfg));
        let router = build_router(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        (addr, state)
    }

    #[tokio::test]
    async fn enforces_origin_cswsh_auth_and_disabled_switch() {
        // 1. Disabled config returns 404
        let disabled_cfg = Config::from_toml_str("version = 1\n[drop]\nenabled = false\n").unwrap();
        let disabled_app = build_router(AppState::new(Arc::new(disabled_cfg)));
        let res = disabled_app
            .oneshot(
                Request::builder()
                    .uri("/api/drop/ws")
                    .header("host", "127.0.0.1:8080")
                    .header("origin", "http://127.0.0.1:8080")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        // 2. Auth + Origin enforcement over real TCP listener
        let (addr, state) = spawn_test_server(
            r#"
version = 1
[auth]
enabled = true
username = "admin"
password = "super-secret-password"
"#,
        )
        .await;
        let origin = format!("http://127.0.0.1:{}", addr.port());
        let valid_cookie = format!("pikbay_session={}", state.auth.issue_session_token());

        // Unauthenticated -> 401
        assert_eq!(
            MiniWsClient::connect(addr, Some(&origin), None).await.err(),
            Some(401)
        );
        // Missing Origin -> 403
        assert_eq!(
            MiniWsClient::connect(addr, None, Some(&valid_cookie))
                .await
                .err(),
            Some(403)
        );
        // Cross-origin -> 403
        assert_eq!(
            MiniWsClient::connect(addr, Some("https://evil.example.com"), Some(&valid_cookie))
                .await
                .err(),
            Some(403)
        );
        // Authenticated + same-origin -> 101 Switching Protocols
        assert!(
            MiniWsClient::connect(addr, Some(&origin), Some(&valid_cookie))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn pairs_relays_ciphertext_enforces_caps_and_destroys_code_after_single_attempt() {
        let (addr, _state) = spawn_test_server(
            r#"
version = 1
[drop]
enabled = true
code_ttl_seconds = 60
max_rooms = 2
per_ip_requests_per_minute = 60
max_relay_mb = 1
"#,
        )
        .await;
        let origin = format!("http://127.0.0.1:{}", addr.port());
        let pub_a = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let salt_a = "BBBBBBBBBBBBBBBBBBBBBB";
        let pub_b = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
        let salt_b = "DDDDDDDDDDDDDDDDDDDDDD";

        // 1. Sender creates room and receives a 6-digit code
        let mut sender = MiniWsClient::connect(addr, Some(&origin), None)
            .await
            .unwrap();
        sender
            .send_text(&format!(
                r#"{{"type":"create","pubKey":"{pub_a}","salt":"{salt_a}"}}"#
            ))
            .await;
        let created = sender.recv_json().await;
        assert_eq!(created["type"], "created");
        let code = created["code"].as_str().unwrap().to_string();
        assert!(is_valid_six_digit_code(&code));

        // 2. Receiver #1 joins with the 6-digit code
        let mut receiver = MiniWsClient::connect(addr, Some(&origin), None)
            .await
            .unwrap();
        receiver
            .send_text(&format!(
                r#"{{"type":"join","code":"{code}","pubKey":"{pub_b}","salt":"{salt_b}"}}"#
            ))
            .await;

        let peer_joined = sender.recv_json().await;
        assert_eq!(peer_joined["type"], "peer_joined");
        assert_eq!(peer_joined["pubKey"], pub_b);

        let joined = receiver.recv_json().await;
        assert_eq!(joined["type"], "joined");
        assert_eq!(joined["pubKey"], pub_a);

        // 3. Second join attempt with the SAME 6-digit code must immediately fail (strict single-attempt pairing)
        let mut intruder = MiniWsClient::connect(addr, Some(&origin), None)
            .await
            .unwrap();
        intruder
            .send_text(&format!(
                r#"{{"type":"join","code":"{code}","pubKey":"{pub_b}","salt":"{salt_b}"}}"#
            ))
            .await;
        let intruder_msg = intruder.recv_json().await;
        assert_eq!(intruder_msg["type"], "error");
        assert_eq!(intruder_msg["code"], "invalid_or_expired");

        // 4. Signaling + 64 KiB binary ciphertext relay works end-to-end
        sender
            .send_text(r#"{"type":"key_confirm","mac":"abcd1234"}"#)
            .await;
        let confirm = receiver.recv_json().await;
        assert_eq!(confirm["type"], "key_confirm");
        assert_eq!(confirm["mac"], "abcd1234");

        let chunk = vec![0x5Au8; 64 * 1024];
        sender.send_binary(&chunk).await;
        let (op, relayed) = receiver.recv_frame().await.unwrap();
        assert_eq!(op, 0x2);
        assert_eq!(relayed, chunk);

        // 5. Exceeding `max_relay_mb = 1` (16 × 64 KiB already has 1 chunk; sending 16 more exceeds 1 MiB) terminates session
        for _ in 0..16 {
            sender.send_binary(&chunk).await;
        }
        let mut saw_limit_err = false;
        while let Some((op, payload)) = sender.recv_frame().await {
            if op == 0x1 {
                let v: serde_json::Value = serde_json::from_slice(&payload).unwrap();
                if v["code"] == "relay_limit_exceeded" {
                    saw_limit_err = true;
                    break;
                }
            } else if op == 0x8 {
                break;
            }
        }
        assert!(
            saw_limit_err,
            "should enforce max_relay_mb ciphertext stream cap"
        );
    }

    #[tokio::test]
    async fn enforces_handshake_concurrency_cap_on_unpaired_sockets() {
        let (addr, _state) = spawn_test_server(
            r#"
version = 1
[drop]
enabled = true
max_rooms = 1
per_ip_requests_per_minute = 120
"#,
        )
        .await;
        let origin = format!("http://127.0.0.1:{}", addr.port());

        // `handshake_sem` allows max(max_rooms * 2, 16) = 16 concurrent unpaired sockets
        let mut held = Vec::new();
        for _ in 0..16 {
            held.push(
                MiniWsClient::connect(addr, Some(&origin), None)
                    .await
                    .unwrap(),
            );
        }
        // 17th unpaired socket is immediately rejected with 429 before upgrading
        assert_eq!(
            MiniWsClient::connect(addr, Some(&origin), None).await.err(),
            Some(429)
        );
    }

    #[test]
    fn max_relay_bytes_accommodates_exact_payload_plus_aead_envelope() {
        let svc = DropService::new(&DropConfig {
            enabled: true,
            code_ttl_seconds: 180,
            max_rooms: 8,
            per_ip_requests_per_minute: 60,
            max_relay_mb: 1,
        });
        let exact_1mib = 1024 * 1024_u64;
        let chunks = exact_1mib.div_ceil(DROP_CHUNK_PLAINTEXT_BYTES);
        // 180 B META wire + 1 MiB payload + 17 * 25 B chunk AEAD tags + 80 B EOF wire
        let realistic_wire = 180 + exact_1mib + chunks * DROP_CHUNK_WIRE_OVERHEAD_BYTES + 80;
        assert!(realistic_wire <= svc.max_relay_bytes());
        assert!(svc.max_relay_bytes() < exact_1mib + 8192);
    }
}
