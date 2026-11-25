use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::{ConnectInfo, FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64ct::{Base64UrlUnpadded, Encoding};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use tokio::sync::Semaphore;
use tracing::warn;

use crate::app::AppState;
use crate::config::{AuthConfig, MAX_PASSWORD_BYTES, MAX_USERNAME_LEN, MIN_PASSWORD_CHARS};
use crate::security::{extract_client_ip, is_trusted_https, normalize_ip};

type HmacSha256 = Hmac<Sha256>;

const SESSION_COOKIE_NAME: &str = "pikbay_session";
const LOGIN_ATTEMPTS_PER_MINUTE: u32 = 5;
/// Caps concurrent Argon2id verifications (~19 MiB each) to prevent multi-IP login floods from triggering OOM.
const MAX_CONCURRENT_ARGON2_VERIFICATIONS: usize = 4;
const ARGON2_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(2);
/// Maximum per-IP rate-limiter buckets retained in memory against spoofed/rotating IPv6 sources.
const MAX_TRACKED_LOGIN_IPS: usize = 16_384;
/// Maximum revoked session nonces held in memory until natural expiration (zero disk writes).
const MAX_REVOKED_SESSIONS: usize = 4_096;

/// Hashes a plaintext password using Argon2id and a 128-bit OS CSPRNG salt.
pub fn hash_password_str(password: &str) -> Result<String, String> {
    let mut salt_bytes = [0u8; 16];
    rand::rng().fill(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| format!("failed to encode password salt: {e}"))?;
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("failed to compute Argon2id password hash: {e}"))
}

/// `pikbay hash-password` subcommand: reads a single password line from stdin and prints an Argon2id PHC hash
/// (never accepts plaintext on argv so credentials are not exposed in `ps`).
pub fn run_hash_password_cli() -> Result<(), String> {
    if std::io::IsTerminal::is_terminal(&io::stdin()) {
        eprint!(
            "Enter password and press Enter ({MIN_PASSWORD_CHARS} chars min, {MAX_PASSWORD_BYTES} bytes max): "
        );
        let _ = io::stderr().flush();
    }
    let mut line = String::new();
    io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| format!("failed to read from stdin: {e}"))?;
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.chars().count() < MIN_PASSWORD_CHARS || trimmed.len() > MAX_PASSWORD_BYTES {
        return Err(format!(
            "password must be at least {MIN_PASSWORD_CHARS} characters and at most {MAX_PASSWORD_BYTES} bytes"
        ));
    }
    let phc = hash_password_str(trimmed)?;
    println!("{phc}");
    Ok(())
}

/// In-memory single-user authentication service (`--read-only` compatible, zero disk writes, immediate logout revocation).
pub struct AuthService {
    enabled: bool,
    username: String,
    target_hash: String,
    /// Dummy hash verified when the username does not match so timing does not leak valid usernames.
    dummy_hash: String,
    session_key: [u8; 32],
    ttl_secs: u64,
    login_limiter: DefaultKeyedRateLimiter<IpAddr>,
    argon2_sem: Arc<Semaphore>,
    revoked_nonces: Mutex<HashMap<String, u64>>,
}

impl AuthService {
    pub fn new(cfg: &AuthConfig) -> Self {
        let mut session_key = [0u8; 32];
        rand::rng().fill(&mut session_key);

        let dummy_hash =
            hash_password_str("pikbay-dummy-anti-enumeration-secret").unwrap_or_default();
        let target_hash = cfg
            .password_hash
            .clone()
            .unwrap_or_else(|| dummy_hash.clone());

        let quota = Quota::per_minute(
            NonZeroU32::new(LOGIN_ATTEMPTS_PER_MINUTE).expect("LOGIN_ATTEMPTS_PER_MINUTE > 0"),
        );

        Self {
            enabled: cfg.enabled,
            username: cfg.username.clone(),
            target_hash,
            dummy_hash,
            session_key,
            ttl_secs: cfg.session_ttl_hours.saturating_mul(3600),
            login_limiter: RateLimiter::keyed(quota),
            argon2_sem: Arc::new(Semaphore::new(MAX_CONCURRENT_ARGON2_VERIFICATIONS)),
            revoked_nonces: Mutex::new(HashMap::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn configured_username(&self) -> &str {
        &self.username
    }

    /// Evicts expired IP rate-limiter buckets and expired revoked session nonces.
    pub fn retain_recent_limiters(&self) {
        self.login_limiter.retain_recent();
        self.login_limiter.shrink_to_fit();

        let now = current_unix_secs();
        let mut guard = self
            .revoked_nonces
            .lock()
            .expect("revoked_nonces mutex poisoned");
        guard.retain(|_, &mut exp| exp > now);
        guard.shrink_to_fit();
    }

    pub fn check_login_rate_limit(&self, ip: IpAddr) -> bool {
        if self.login_limiter.len() >= MAX_TRACKED_LOGIN_IPS {
            self.retain_recent_limiters();
            if self.login_limiter.len() >= MAX_TRACKED_LOGIN_IPS {
                return false;
            }
        }
        self.login_limiter.check_key(&ip).is_ok()
    }

    /// Checks whether any `pikbay_session` cookie on the request is valid
    /// (iterates all matching cookies so sibling-subdomain cookie tossing cannot mask a valid session).
    pub fn is_request_authenticated(&self, headers: &HeaderMap) -> bool {
        if !self.enabled {
            return true;
        }
        let mut any_valid = false;
        for_each_cookie(headers, SESSION_COOKIE_NAME, |token| {
            if self.verify_session_token(token) {
                any_valid = true;
            }
        });
        any_valid
    }

    /// Adds all valid session tokens carried on the request to the in-memory revocation table
    /// so copied token strings become invalid immediately upon logout.
    pub fn revoke_request_sessions(&self, headers: &HeaderMap) {
        if !self.enabled {
            return;
        }
        for_each_cookie(headers, SESSION_COOKIE_NAME, |token| {
            self.revoke_session_token(token);
        });
    }

    pub fn revoke_session_token(&self, token: &str) {
        let Some((nonce_b64, exp)) = self.verify_token_signature_and_exp(token) else {
            return;
        };
        let now = current_unix_secs();
        let mut guard = self
            .revoked_nonces
            .lock()
            .expect("revoked_nonces mutex poisoned");
        guard.retain(|_, &mut e| e > now);
        if guard.len() >= MAX_REVOKED_SESSIONS && !guard.contains_key(&nonce_b64) {
            if let Some(oldest_key) = guard
                .iter()
                .min_by_key(|(_, &e)| e)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest_key);
            }
        }
        guard.insert(nonce_b64, exp);
    }

    /// Performs constant-time username comparison and Argon2id password verification on the blocking pool.
    /// Moves `OwnedSemaphorePermit` into the blocking closure so aborted HTTP requests cannot release the concurrency slot
    /// before Argon2 finishes computing.
    pub async fn verify_credentials(&self, input_user: &str, input_pass: &str) -> Option<bool> {
        if !self.enabled {
            return Some(true);
        }

        let permit = tokio::time::timeout(
            ARGON2_ACQUIRE_TIMEOUT,
            Arc::clone(&self.argon2_sem).acquire_owned(),
        )
        .await
        .ok()?
        .ok()?;

        let expected_user = self.username.clone();
        let user_candidate = input_user.to_string();
        let pass_candidate = input_pass.to_string();

        let user_matches = bool::from(expected_user.as_bytes().ct_eq(user_candidate.as_bytes()));
        let hash_to_check = if user_matches {
            self.target_hash.clone()
        } else {
            self.dummy_hash.clone()
        };

        let pass_matches = tokio::task::spawn_blocking(move || {
            let _held_permit = permit;
            let Ok(parsed) = PasswordHash::new(&hash_to_check) else {
                return false;
            };
            Argon2::default()
                .verify_password(pass_candidate.as_bytes(), &parsed)
                .is_ok()
        })
        .await
        .unwrap_or(false);

        Some(user_matches && pass_matches)
    }

    pub fn issue_session_token(&self) -> String {
        let now = current_unix_secs();
        let exp = now.saturating_add(self.ttl_secs);
        let mut nonce = [0u8; 12];
        rand::rng().fill(&mut nonce);
        let nonce_b64 = Base64UrlUnpadded::encode_string(&nonce);
        let payload = format!("{exp}.{nonce_b64}");
        let sig = self.sign_payload(&payload);
        format!("{payload}.{sig}")
    }

    fn verify_token_signature_and_exp(&self, token: &str) -> Option<(String, u64)> {
        let mut parts = token.splitn(3, '.');
        let (exp_str, nonce_b64, sig_b64) = (parts.next()?, parts.next()?, parts.next()?);
        if nonce_b64.is_empty() || sig_b64.is_empty() || nonce_b64.len() > 64 {
            return None;
        }
        let exp = exp_str.parse::<u64>().ok()?;

        let payload = format!("{exp_str}.{nonce_b64}");
        let sig_bytes = Base64UrlUnpadded::decode_vec(sig_b64).ok()?;
        let mut mac = HmacSha256::new_from_slice(&self.session_key).ok()?;
        mac.update(payload.as_bytes());
        mac.verify_slice(&sig_bytes).ok()?;

        if current_unix_secs() >= exp {
            return None;
        }
        Some((nonce_b64.to_string(), exp))
    }

    pub fn verify_session_token(&self, token: &str) -> bool {
        let Some((nonce_b64, _exp)) = self.verify_token_signature_and_exp(token) else {
            return false;
        };
        let guard = self
            .revoked_nonces
            .lock()
            .expect("revoked_nonces mutex poisoned");
        !guard.contains_key(&nonce_b64)
    }

    fn sign_payload(&self, payload: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.session_key).expect("valid 32-byte HMAC key");
        mac.update(payload.as_bytes());
        let bytes = mac.finalize().into_bytes();
        Base64UrlUnpadded::encode_string(&bytes)
    }

    pub fn build_set_cookie(&self, token: &str, secure: bool) -> HeaderValue {
        let secure_attr = if secure { "; Secure" } else { "" };
        let val = format!(
            "{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{secure_attr}",
            self.ttl_secs
        );
        HeaderValue::from_str(&val)
            .unwrap_or_else(|_| HeaderValue::from_static("pikbay_session=; Max-Age=0"))
    }

    pub fn build_clear_cookie(secure: bool) -> HeaderValue {
        let secure_attr = if secure { "; Secure" } else { "" };
        let val =
            format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure_attr}");
        HeaderValue::from_str(&val)
            .unwrap_or_else(|_| HeaderValue::from_static("pikbay_session=; Max-Age=0"))
    }
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn for_each_cookie<F: FnMut(&str)>(headers: &HeaderMap, name: &str, mut f: F) {
    for val in headers.get_all(header::COOKIE) {
        let Ok(raw) = val.to_str() else {
            continue;
        };
        for pair in raw.split(';') {
            let trimmed = pair.trim();
            if let Some((k, v)) = trimmed.split_once('=') {
                if k.trim() == name {
                    let token = v.trim();
                    if !token.is_empty() {
                        f(token);
                    }
                }
            }
        }
    }
}

fn peer_ip_from_request(req: &Request) -> IpAddr {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| normalize_ip(ci.0.ip()))
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

/// Peer address extractor compatible with both production TCP `ConnectInfo` and `oneshot` unit tests.
pub struct PeerIp(pub IpAddr);

impl<S: Send + Sync> FromRequestParts<S> for PeerIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ci| normalize_ip(ci.0.ip()))
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        Ok(Self(ip))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
struct AuthStatusBody {
    authenticated: bool,
    username: Option<String>,
}

#[derive(Serialize)]
struct AuthErrorBody {
    error: &'static str,
    message: &'static str,
}

/// `POST /api/auth/login`
pub async fn post_login(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Response {
    let client_ip = extract_client_ip(peer_ip, &headers, &state.config.server.trusted_proxies);

    if !state.auth.is_enabled() {
        return (
            StatusCode::OK,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(AuthStatusBody {
                authenticated: true,
                username: None,
            }),
        )
            .into_response();
    }

    if !state.auth.check_login_rate_limit(client_ip) {
        warn!(client_ip = %client_ip, path = "/api/auth/login", "login request hit brute-force rate limit");
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
                (header::RETRY_AFTER, HeaderValue::from_static("60")),
            ],
            Json(AuthErrorBody {
                error: "rate_limited",
                message: "Too many login attempts; please try again in 1 minute",
            }),
        )
            .into_response();
    }

    let trimmed_user = payload.username.trim();
    if trimmed_user.is_empty()
        || trimmed_user.chars().count() > MAX_USERNAME_LEN
        || payload.password.is_empty()
        || payload.password.len() > MAX_PASSWORD_BYTES
    {
        return unauthorized_response("Invalid username or password");
    }

    let Some(ok) = state
        .auth
        .verify_credentials(trimmed_user, &payload.password)
        .await
    else {
        warn!(
            client_ip = %client_ip,
            path = "/api/auth/login",
            "concurrent Argon2 verification queue saturated; rejecting request early to protect memory"
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
                (header::RETRY_AFTER, HeaderValue::from_static("5")),
            ],
            Json(AuthErrorBody {
                error: "rate_limited",
                message: "Server busy; please retry shortly",
            }),
        )
            .into_response();
    };

    if !ok {
        warn!(client_ip = %client_ip, path = "/api/auth/login", "authentication failed: invalid credentials");
        return unauthorized_response("Invalid username or password");
    }

    let secure = is_trusted_https(peer_ip, &headers, &state.config.server.trusted_proxies);
    let token = state.auth.issue_session_token();
    let cookie = state.auth.build_set_cookie(&token, secure);

    (
        StatusCode::OK,
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (header::SET_COOKIE, cookie),
        ],
        Json(AuthStatusBody {
            authenticated: true,
            username: Some(state.auth.configured_username().to_string()),
        }),
    )
        .into_response()
}

/// `POST /api/auth/logout`
pub async fn post_logout(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    headers: HeaderMap,
) -> Response {
    state.auth.revoke_request_sessions(&headers);
    let secure = is_trusted_https(peer_ip, &headers, &state.config.server.trusted_proxies);
    let clear_cookie = AuthService::build_clear_cookie(secure);

    (
        StatusCode::OK,
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (header::SET_COOKIE, clear_cookie),
        ],
        Json(AuthStatusBody {
            authenticated: !state.auth.is_enabled(),
            username: None,
        }),
    )
        .into_response()
}

/// Authentication gate middleware for protected routes: returns 401 when `auth.enabled = true` and no valid session is present.
pub async fn require_auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    if state.auth.is_request_authenticated(req.headers()) {
        return next.run(req).await;
    }

    let peer_ip = peer_ip_from_request(&req);
    let client_ip = extract_client_ip(
        peer_ip,
        req.headers(),
        &state.config.server.trusted_proxies,
    );
    warn!(
        client_ip = %client_ip,
        path = %req.uri().path(),
        "unauthorized access to protected resource"
    );
    unauthorized_response("Authentication required or session expired")
}

fn unauthorized_response(message: &'static str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(AuthErrorBody {
            error: "unauthorized",
            message,
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hashes_verifies_and_revokes_tokens_correctly() {
        let phc = hash_password_str("correct-horse-battery").unwrap();
        let cfg = AuthConfig {
            enabled: true,
            username: "admin".to_string(),
            password_hash: Some(phc),
            session_ttl_hours: 24,
        };
        let svc = AuthService::new(&cfg);

        assert_eq!(
            svc.verify_credentials("admin", "correct-horse-battery").await,
            Some(true)
        );
        assert_eq!(
            svc.verify_credentials("admin", "wrong-password").await,
            Some(false)
        );
        assert_eq!(
            svc.verify_credentials("other", "correct-horse-battery").await,
            Some(false)
        );

        let token = svc.issue_session_token();
        assert!(svc.verify_session_token(&token));
        assert!(!svc.verify_session_token(&format!("{token}tampered")));

        // Revoked tokens must become invalid immediately
        svc.revoke_session_token(&token);
        assert!(!svc.verify_session_token(&token));
    }
}
