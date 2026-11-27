use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tracing::warn;

use crate::app::AppState;

/// Strict baseline CSP: zero external origins, no inline scripts, and no inline `style` attributes.
pub const CSP_HEADER_VALUE: &str = concat!(
    "default-src 'none'; ",
    "script-src 'self'; ",
    "style-src 'self'; ",
    "img-src 'self' data: blob:; ",
    "font-src 'self'; ",
    "connect-src 'self'; ",
    "worker-src 'self' blob:; ",
    "manifest-src 'self'; ",
    "base-uri 'none'; ",
    "form-action 'none'; ",
    "frame-ancestors 'none'; ",
    "object-src 'none'"
);

/// Sandboxed CSP dedicated to standalone SVG icons (blocks embedded scripts and external network calls).
pub const SVG_ICON_CSP_VALUE: &str =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

pub const PERMISSIONS_POLICY_VALUE: &str = concat!(
    "camera=(), microphone=(), geolocation=(), usb=(), serial=(), ",
    "bluetooth=(), payment=(), interest-cohort=(), clipboard-write=(self)"
);

/// Standard-library IPv4 / IPv6 CIDR matcher used for `server.trusted_proxies`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpNet {
    V4 { network: u32, mask: u32 },
    V6 { network: u128, mask: u128 },
}

impl IpNet {
    pub fn parse(input: &str) -> Result<Self, String> {
        let trimmed = input.trim();
        if let Some((addr_str, prefix_str)) = trimmed.split_once('/') {
            let addr: IpAddr = addr_str
                .parse()
                .map_err(|e| format!("invalid IP address: {e}"))?;
            let prefix: u8 = prefix_str
                .parse()
                .map_err(|e| format!("invalid CIDR prefix length: {e}"))?;
            Self::from_addr_prefix(addr, prefix)
        } else {
            let addr: IpAddr = trimmed
                .parse()
                .map_err(|e| format!("invalid IP address: {e}"))?;
            let prefix = match addr {
                IpAddr::V4(_) => 32,
                IpAddr::V6(_) => 128,
            };
            Self::from_addr_prefix(addr, prefix)
        }
    }

    fn from_addr_prefix(addr: IpAddr, prefix: u8) -> Result<Self, String> {
        match addr {
            IpAddr::V4(v4) => {
                if prefix > 32 {
                    return Err("IPv4 CIDR prefix length must be <= 32".to_string());
                }
                let mask = if prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                Ok(Self::V4 {
                    network: v4.to_bits() & mask,
                    mask,
                })
            }
            IpAddr::V6(v6) => {
                if prefix > 128 {
                    return Err("IPv6 CIDR prefix length must be <= 128".to_string());
                }
                let mask = if prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                Ok(Self::V6 {
                    network: v6.to_bits() & mask,
                    mask,
                })
            }
        }
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        let normalized = normalize_ip(ip);
        match (*self, normalized) {
            (Self::V4 { network, mask }, IpAddr::V4(v4)) => (v4.to_bits() & mask) == network,
            (Self::V6 { network, mask }, IpAddr::V6(v6)) => (v6.to_bits() & mask) == network,
            _ => false,
        }
    }
}

/// Normalizes IPv4-mapped IPv6 addresses (e.g. `::ffff:127.0.0.1`) to canonical IPv4 for dual-stack listeners.
pub fn normalize_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(v4) => IpAddr::V4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
    }
}

pub fn is_trusted_proxy(ip: IpAddr, trusted_proxies: &[IpNet]) -> bool {
    let ip = normalize_ip(ip);
    trusted_proxies.iter().any(|net| net.contains(ip))
}

/// Returns `true` when a request arrives via a trusted proxy advertising `X-Forwarded-Proto: https`
/// (used to attach the `Secure` attribute on session cookies).
pub fn is_trusted_https(peer_ip: IpAddr, headers: &HeaderMap, trusted_proxies: &[IpNet]) -> bool {
    if !is_trusted_proxy(peer_ip, trusted_proxies) {
        return false;
    }
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .is_some_and(|proto| proto.trim().eq_ignore_ascii_case("https"))
}

/// Extracts the effective client IP:
/// `X-Forwarded-For` is consulted only when the immediate TCP peer belongs to `trusted_proxies`,
/// scanning right-to-left for the first valid IP outside `trusted_proxies`.
pub fn extract_client_ip(
    peer_ip: IpAddr,
    headers: &HeaderMap,
    trusted_proxies: &[IpNet],
) -> IpAddr {
    let peer_ip = normalize_ip(peer_ip);
    if !is_trusted_proxy(peer_ip, trusted_proxies) {
        return peer_ip;
    }

    let mut chain: Vec<IpAddr> = Vec::new();
    for value in headers.get_all("x-forwarded-for") {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        for part in raw.split(',') {
            let candidate = part.trim();
            if candidate.is_empty() {
                continue;
            }
            if let Ok(ip) = candidate.parse::<IpAddr>() {
                chain.push(normalize_ip(ip));
            }
        }
    }

    if chain.is_empty() {
        return peer_ip;
    }

    for ip in chain.iter().rev() {
        if !is_trusted_proxy(*ip, trusted_proxies) {
            return *ip;
        }
    }

    chain[0]
}

/// Splits an HTTP `Host` / `:authority` string into lowercase host and optional port.
pub fn split_authority_host_port(raw: &str) -> Option<(String, Option<String>)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with('[') {
        let end = lower.find(']')?;
        let host = lower[..=end].to_string();
        let rest = &lower[end + 1..];
        if rest.is_empty() {
            Some((host, None))
        } else {
            let port = rest.strip_prefix(':')?.to_string();
            if port.is_empty() {
                return None;
            }
            Some((host, Some(port)))
        }
    } else if let Some((h, p)) = lower.rsplit_once(':') {
        if h.is_empty() || p.is_empty() || h.contains(':') {
            return None;
        }
        Some((h.to_string(), Some(p.to_string())))
    } else {
        Some((lower, None))
    }
}

/// Resolves the effective request authority (`X-Forwarded-Host` from a trusted proxy, falling back to `Host` and URI authority).
pub fn effective_request_authority<'a>(
    peer_ip: IpAddr,
    headers: &'a HeaderMap,
    uri_authority: Option<&'a str>,
    trusted_proxies: &[IpNet],
) -> Option<&'a str> {
    let forwarded_host = if is_trusted_proxy(peer_ip, trusted_proxies) {
        headers
            .get("x-forwarded-host")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(str::trim)
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    forwarded_host
        .or_else(|| {
            headers
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .or(uri_authority)
}

/// Checks whether the effective request `Host` matches `server.allowed_hosts` (empty allowlist permits all hosts).
pub fn is_allowed_host(
    peer_ip: IpAddr,
    headers: &HeaderMap,
    uri_authority: Option<&str>,
    trusted_proxies: &[IpNet],
    allowed_hosts: &[String],
) -> bool {
    if allowed_hosts.is_empty() {
        return true;
    }

    let Some(candidate) =
        effective_request_authority(peer_ip, headers, uri_authority, trusted_proxies)
    else {
        return false;
    };
    let Some((cand_host, cand_port)) = split_authority_host_port(candidate) else {
        return false;
    };

    allowed_hosts.iter().any(|rule| {
        let Some((rule_host, rule_port)) = split_authority_host_port(rule) else {
            return false;
        };
        if rule_port.is_some() {
            cand_host == rule_host && cand_port == rule_port
        } else {
            cand_host == rule_host
        }
    })
}

/// Validates Fetch Metadata (`Sec-Fetch-Site`) and `Origin` against the target authority to block cross-site / sibling-subdomain CSRF.
pub fn is_same_origin_api_request(
    peer_ip: IpAddr,
    headers: &HeaderMap,
    uri_authority: Option<&str>,
    trusted_proxies: &[IpNet],
) -> bool {
    if let Some(sec_site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        let s = sec_site.trim();
        if !s.eq_ignore_ascii_case("same-origin") && !s.eq_ignore_ascii_case("none") {
            return false;
        }
    }

    if let Some(origin_raw) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let trimmed = origin_raw.trim();
        let (orig_scheme, scheme_default_port, orig_authority) =
            if let Some(rest) = trimmed.strip_prefix("https://") {
                ("https", "443", rest)
            } else if let Some(rest) = trimmed.strip_prefix("http://") {
                ("http", "80", rest)
            } else {
                // Reject `Origin: null` and non-HTTP(S) schemes
                return false;
            };

        if orig_authority.contains(['/', '?', '#', '@']) {
            return false;
        }

        // When behind a trusted reverse proxy advertising `X-Forwarded-Proto`, enforce exact scheme matching
        // (blocking `http://` MITM downgrade CSRF against `https://` deployments while preserving compatibility
        // when untrusted bridge proxies do not forward scheme headers).
        let forwarded_proto = if is_trusted_proxy(peer_ip, trusted_proxies) {
            headers
                .get("x-forwarded-proto")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.split(',').next())
                .map(str::trim)
                .filter(|s| s.eq_ignore_ascii_case("https") || s.eq_ignore_ascii_case("http"))
        } else {
            None
        };

        if let Some(proto) = forwarded_proto {
            if !proto.eq_ignore_ascii_case(orig_scheme) {
                return false;
            }
        }

        let Some((orig_host, orig_port)) = split_authority_host_port(orig_authority) else {
            return false;
        };
        let Some(target_auth) =
            effective_request_authority(peer_ip, headers, uri_authority, trusted_proxies)
        else {
            return false;
        };
        let Some((cand_host, cand_port)) = split_authority_host_port(target_auth) else {
            return false;
        };

        if orig_host != cand_host {
            return false;
        }

        let target_default_port = match forwarded_proto {
            Some(p) if p.eq_ignore_ascii_case("https") => "443",
            Some(p) if p.eq_ignore_ascii_case("http") => "80",
            _ => scheme_default_port,
        };
        let orig_eff_port = orig_port.as_deref().unwrap_or(scheme_default_port);
        let cand_eff_port = cand_port.as_deref().unwrap_or(target_default_port);
        if orig_eff_port != cand_eff_port {
            return false;
        }
    }

    true
}

/// Same-origin API guard middleware protecting all `/api/*` routes from CSRF and cross-origin probing.
pub async fn same_origin_api_guard_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if path != "/api" && !path.starts_with("/api/") {
        return next.run(req).await;
    }

    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| normalize_ip(ci.0.ip()))
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));

    if is_same_origin_api_request(
        peer_ip,
        req.headers(),
        req.uri().authority().map(|a| a.as_str()),
        &state.config.server.trusted_proxies,
    ) {
        return next.run(req).await;
    }

    let client_ip = extract_client_ip(peer_ip, req.headers(), &state.config.server.trusted_proxies);
    warn!(
        client_ip = %client_ip,
        path = %path,
        "blocked cross-origin or forged-Origin API request"
    );

    (
        StatusCode::FORBIDDEN,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        r#"{"error":"forbidden_origin","message":"Cross-origin API requests are forbidden"}"#,
    )
        .into_response()
}

/// Optional Host allowlist middleware: rejects IP scans and unknown `Host` headers with `421 Misdirected Request`
/// when `server.allowed_hosts` is non-empty. Local loopback `GET /healthz` probes are exempted only when both
/// the TCP peer and resolved client IP are loopback addresses.
pub async fn allowed_hosts_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let allowed = &state.config.server.allowed_hosts;
    if allowed.is_empty() {
        return next.run(req).await;
    }

    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| normalize_ip(ci.0.ip()))
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));

    let client_ip = extract_client_ip(peer_ip, req.headers(), &state.config.server.trusted_proxies);

    if peer_ip.is_loopback() && client_ip.is_loopback() && req.uri().path() == "/healthz" {
        return next.run(req).await;
    }

    let ok = is_allowed_host(
        peer_ip,
        req.headers(),
        req.uri().authority().map(|a| a.as_str()),
        &state.config.server.trusted_proxies,
        allowed,
    );

    if ok {
        return next.run(req).await;
    }

    warn!(
        client_ip = %client_ip,
        path = %req.uri().path(),
        "rejected request with Host outside server.allowed_hosts"
    );

    (
        StatusCode::MISDIRECTED_REQUEST,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        "",
    )
        .into_response()
}

/// Injects baseline security headers on every HTTP response (preserving stricter route-specific CSP headers when already set).
pub async fn security_headers_middleware(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    apply_security_headers(response.headers_mut());
    response
}

pub fn apply_security_headers(headers: &mut HeaderMap) {
    headers
        .entry("content-security-policy")
        .or_insert_with(|| HeaderValue::from_static(CSP_HEADER_VALUE));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static(PERMISSIONS_POLICY_VALUE),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cidr_matching_works_for_v4_and_v6() {
        let v4_net = IpNet::parse("10.20.0.0/16").unwrap();
        assert!(v4_net.contains("10.20.3.4".parse().unwrap()));
        assert!(!v4_net.contains("10.21.0.1".parse().unwrap()));

        let v6_net = IpNet::parse("fd00:1234::/32").unwrap();
        assert!(v6_net.contains("fd00:1234::abcd".parse().unwrap()));
        assert!(!v6_net.contains("fd00:9999::1".parse().unwrap()));

        let lo = IpNet::parse("127.0.0.1/32").unwrap();
        assert!(lo.contains("::ffff:127.0.0.1".parse().unwrap()));
    }

    #[test]
    fn ignores_xff_from_untrusted_peer() {
        let trusted = vec![IpNet::parse("127.0.0.1/32").unwrap()];
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.2.3.4, 5.6.7.8"),
        );

        let peer: IpAddr = "192.168.1.50".parse().unwrap();
        assert_eq!(extract_client_ip(peer, &headers, &trusted), peer);
    }

    #[test]
    fn extracts_rightmost_untrusted_ip_from_xff() {
        let trusted = vec![
            IpNet::parse("127.0.0.1/32").unwrap(),
            IpNet::parse("10.0.0.0/8").unwrap(),
        ];
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("8.8.8.8, 100.64.1.9, 10.0.0.2"),
        );

        let peer: IpAddr = "127.0.0.1".parse().unwrap();
        let expected: IpAddr = "100.64.1.9".parse().unwrap();
        assert_eq!(extract_client_ip(peer, &headers, &trusted), expected);
    }

    #[test]
    fn same_origin_guard_enforces_scheme_and_normalized_ports() {
        let trusted = vec![IpNet::parse("127.0.0.1/32").unwrap()];
        let peer: IpAddr = "127.0.0.1".parse().unwrap();

        // 1. Rejects http -> https scheme downgrade when trusted proxy reports X-Forwarded-Proto: https
        let mut downgrade = HeaderMap::new();
        downgrade.insert(header::HOST, HeaderValue::from_static("pikbay.example.com"));
        downgrade.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        downgrade.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://pikbay.example.com"),
        );
        assert!(!is_same_origin_api_request(
            peer, &downgrade, None, &trusted
        ));

        // 2. Rejects cross-port `http://pikbay.example.com:443` against portless `Host: pikbay.example.com`
        let mut cross_port = HeaderMap::new();
        cross_port.insert(header::HOST, HeaderValue::from_static("pikbay.example.com"));
        cross_port.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://pikbay.example.com:443"),
        );
        assert!(!is_same_origin_api_request(
            peer,
            &cross_port,
            None,
            &trusted
        ));

        // 3. Accepts matching https origin with implicit 443 or explicit :443
        let mut ok_https = HeaderMap::new();
        ok_https.insert(header::HOST, HeaderValue::from_static("pikbay.example.com"));
        ok_https.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        ok_https.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://pikbay.example.com:443"),
        );
        assert!(is_same_origin_api_request(peer, &ok_https, None, &trusted));
    }
}
