use std::sync::Arc;
use std::time::Duration;

use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::compression::CompressionLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::assets;
use crate::auth::{self, AuthService};
use crate::config::Config;
use crate::dashboard;
use crate::meta;
use crate::security::{
    allowed_hosts_middleware, same_origin_api_guard_middleware, security_headers_middleware,
};
use crate::speedtest::{self, SpeedtestService};
use crate::system::{self, SystemService};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub auth: Arc<AuthService>,
    pub speedtest: Arc<SpeedtestService>,
    pub system: Arc<SystemService>,
}

impl AppState {
    pub fn new(config: Arc<Config>) -> Self {
        let auth = Arc::new(AuthService::new(&config.auth));
        let speedtest = Arc::new(SpeedtestService::new(&config.speedtest));
        let system = Arc::new(SystemService::new(&config.system));
        Self {
            config,
            auth,
            speedtest,
            system,
        }
    }
}

#[derive(Serialize)]
struct ApiErrorBody {
    error: &'static str,
    message: &'static str,
}

async fn api_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(ApiErrorBody {
            error: "not_found",
            message: "Requested API endpoint does not exist",
        }),
    )
        .into_response()
}

pub fn build_router(state: AppState) -> Router {
    // 1. Speedtest route group: kept outside response compression and the standard 64 KiB body limit
    //    so raw network throughput is measured accurately, while still protected by auth, allowed_hosts,
    //    same-origin guard, and outer security headers.
    let speed_router = Router::new()
        .route("/ping", get(speedtest::get_ping))
        .route("/down", get(speedtest::get_down))
        .route("/up", post(speedtest::post_up))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth_middleware,
        ));

    // 2. Standard JSON APIs and embedded static assets (gzip/br compression + 64 KiB body cap)
    let protected_api = Router::new()
        .route("/dashboard", get(dashboard::get_dashboard))
        .route("/system", get(system::get_system))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth_middleware,
        ));

    let api_router = Router::new()
        .route("/meta", get(meta::get_meta))
        .route("/auth/login", post(auth::post_login))
        .route("/auth/logout", post(auth::post_logout))
        .merge(protected_api)
        .fallback(api_not_found);

    let icons_router = Router::new()
        .route("/{filename}", get(dashboard::get_icon))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth_middleware,
        ));

    let standard_routes = Router::new()
        .route("/healthz", get(meta::healthz))
        .nest("/api", api_router)
        .nest("/icons", icons_router)
        .fallback(assets::serve_embedded)
        .layer(CompressionLayer::new())
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ));

    Router::new()
        .nest("/api/speed", speed_router)
        .merge(standard_routes)
        .with_state(state.clone())
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            same_origin_api_guard_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state,
            allowed_hosts_middleware,
        ))
        // Outermost layer ensures security headers are present on every response (including 401/403/404/405/408/413/421/429)
        .layer(middleware::from_fn(security_headers_middleware))
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use axum::body::Body;
    use axum::http::{Method, Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;
    use crate::assets::serve_with_provider;
    use crate::security::{CSP_HEADER_VALUE, SVG_ICON_CSP_VALUE};

    fn sample_state() -> AppState {
        let cfg = Config::from_toml_str(include_str!("../config.example.toml")).unwrap();
        AppState::new(Arc::new(cfg))
    }

    fn assert_common_security_headers(headers: &axum::http::HeaderMap) {
        assert!(headers.get("content-security-policy").is_some());
        assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
        assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
        assert_eq!(
            headers.get("cross-origin-opener-policy").unwrap(),
            "same-origin"
        );
        assert_eq!(
            headers.get("cross-origin-resource-policy").unwrap(),
            "same-origin"
        );
        assert!(headers.get("permissions-policy").is_some());
    }

    #[tokio::test]
    async fn healthz_and_method_restriction() {
        let app = build_router(sample_state());

        let res = app
            .clone()
            .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers().get("cache-control").unwrap(), "no-store");
        assert_eq!(
            res.headers().get("content-security-policy").unwrap(),
            CSP_HEADER_VALUE
        );
        assert_common_security_headers(res.headers());

        let post_res = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_res.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_common_security_headers(post_res.headers());
    }

    #[tokio::test]
    async fn speedtest_endpoints_stream_uncompressed_and_enforce_caps_and_429() {
        let cfg_toml = r#"
version = 1
[speedtest]
enabled = true
max_download_mb = 2
max_upload_mb = 1
per_ip_concurrency = 2
global_concurrency = 4
per_ip_requests_per_minute = 4
daily_quota_gb = 1
"#;
        let cfg = Config::from_toml_str(cfg_toml).unwrap();
        let app = build_router(AppState::new(Arc::new(cfg)));

        // 1. Ping returns an empty 200 OK response
        let ping_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/speed/ping?r=1")
                    .header("accept-encoding", "gzip, br")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ping_res.status(), StatusCode::OK);
        assert_common_security_headers(ping_res.headers());

        // 2. Download streams uncompressed bytes even with `accept-encoding: gzip` and clamps to `max_download_mb` (2 MiB)
        let down_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/speed/down?size=10485760")
                    .header("accept-encoding", "gzip, br")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(down_res.status(), StatusCode::OK);
        assert!(down_res.headers().get("content-encoding").is_none());
        assert_eq!(
            down_res.headers().get("cache-control").unwrap(),
            "no-store, no-cache, max-age=0, no-transform"
        );
        let down_bytes = down_res.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(down_bytes.len(), 2 * 1024 * 1024);

        // 3. Upload counts streamed bytes (> 64 KiB, verifying exemption from standard 64 KiB API cap)
        let payload_200k = vec![0xABu8; 200 * 1024];
        let up_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/speed/up")
                    .body(Body::from(payload_200k))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(up_res.status(), StatusCode::OK);
        let up_json: serde_json::Value = serde_json::from_slice(
            &up_res.into_body().collect().await.unwrap().to_bytes(),
        )
        .unwrap();
        assert_eq!(up_json["receivedBytes"], 200 * 1024);

        // 4. Upload exceeding `max_upload_mb` (1 MiB) returns 413 Payload Too Large
        let payload_over = vec![0xCDu8; 1024 * 1024 + 1024];
        let over_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/speed/up")
                    .body(Body::from(payload_over))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(over_res.status(), StatusCode::PAYLOAD_TOO_LARGE);

        // 5. The 5th request exceeds `per_ip_requests_per_minute = 4` and returns 429 + Retry-After
        let limited_res = app
            .oneshot(
                Request::builder()
                    .uri("/api/speed/ping?r=5")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(limited_res.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(limited_res.headers().get("retry-after").is_some());
    }

    #[tokio::test]
    async fn dashboard_and_sandboxed_svg_icons_work() {
        let tmp_icons = std::env::temp_dir().join(format!(
            "pikbay-test-icons-{}-{}",
            std::process::id(),
            rand::random::<u32>()
        ));
        std::fs::create_dir_all(&tmp_icons).unwrap();
        std::fs::write(
            tmp_icons.join("custom.svg"),
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>"#,
        )
        .unwrap();

        let cfg_toml = format!(
            r#"
version = 1
[server]
icons_dir = '{}'
[[groups]]
name = "Core Services"
[[groups.items]]
name = "Jellyfin"
url = "https://media.example.ts.net"
icon = "custom.svg"
"#,
            tmp_icons.display()
        );
        let cfg = Config::from_toml_str(&cfg_toml).unwrap();
        let app = build_router(AppState::new(Arc::new(cfg)));

        let dash_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(dash_res.status(), StatusCode::OK);
        let bytes = dash_res.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["groups"][0]["items"][0]["iconUrl"], "/icons/custom.svg");
        assert_eq!(json["groups"][0]["items"][0]["host"], "media.example.ts.net");

        let icon_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/icons/custom.svg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(icon_res.status(), StatusCode::OK);
        assert_eq!(
            icon_res.headers().get("content-type").unwrap(),
            "image/svg+xml"
        );
        assert_eq!(
            icon_res.headers().get("content-security-policy").unwrap(),
            SVG_ICON_CSP_VALUE
        );
        assert_common_security_headers(icon_res.headers());

        let missing_icon = app
            .oneshot(
                Request::builder()
                    .uri("/icons/nonexistent.svg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_icon.status(), StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&tmp_icons);
    }

    #[tokio::test]
    async fn system_telemetry_endpoint_returns_live_metrics_and_respects_disable_switch() {
        let state = sample_state();
        tokio::time::sleep(Duration::from_millis(60)).await;
        state.system.sample_once();
        let app = build_router(state);

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/system")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let json: serde_json::Value =
            serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(json["refreshSeconds"], 1);
        #[cfg(target_os = "linux")]
        {
            assert!(json["cpu"]["totalCores"].as_u64().unwrap() >= 1);
            assert!(!json["cpu"]["perCore"].as_array().unwrap().is_empty());
            assert!(json["memory"]["totalBytes"].as_u64().unwrap() > 0);
        }
        #[cfg(unix)]
        {
            assert!(json["disks"][0]["totalBytes"].as_u64().unwrap() > 0);
        }

        // Must return 404 when `system.enabled = false`
        let disabled_cfg = Config::from_toml_str("version = 1\n[system]\nenabled = false\n").unwrap();
        let disabled_app = build_router(AppState::new(Arc::new(disabled_cfg)));
        let disabled_res = disabled_app
            .oneshot(
                Request::builder()
                    .uri("/api/system")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(disabled_res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn auth_gate_blocks_protected_endpoints_and_rate_limits_bruteforce() {
        let cfg_toml = r#"
version = 1
[auth]
enabled = true
username = "admin"
password = "super-secret-password"

[[groups]]
name = "Private Nodes"
[[groups.items]]
name = "Vault"
url = "https://vault.example.ts.net"
icon = "jellyfin.svg"
"#;
        let cfg = Config::from_toml_str(cfg_toml).unwrap();
        let app = build_router(AppState::new(Arc::new(cfg)));

        for protected in ["/api/dashboard", "/icons/jellyfin.svg", "/api/speed/ping"] {
            let unauth = app
                .clone()
                .oneshot(Request::builder().uri(protected).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                unauth.status(),
                StatusCode::UNAUTHORIZED,
                "{protected} should require authentication"
            );
        }

        let login_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"username":"admin","password":"super-secret-password"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_res.status(), StatusCode::OK);
        let set_cookie = login_res
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(set_cookie.contains("HttpOnly"));
        let cookie_pair = set_cookie.split(';').next().unwrap();

        let authed_dash = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard")
                    .header("cookie", cookie_pair)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(authed_dash.status(), StatusCode::OK);

        let mut hit_429 = false;
        for _ in 0..6 {
            let bad = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/auth/login")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"username":"admin","password":"wrong"}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            if bad.status() == StatusCode::TOO_MANY_REQUESTS {
                hit_429 = true;
                break;
            }
        }
        assert!(hit_429, "should return 429 once per-minute login attempts are exceeded");
    }

    #[tokio::test]
    async fn allowed_hosts_blocks_ip_scanning_and_unknown_domains() {
        let cfg_toml = r#"
version = 1
[server]
allowed_hosts = ["panel.example.ts.net"]
"#;
        let cfg = Config::from_toml_str(cfg_toml).unwrap();
        let app = build_router(AppState::new(Arc::new(cfg)));

        let ip_scan = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/meta")
                    .header("host", "203.0.113.99:8080")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ip_scan.status(), StatusCode::MISDIRECTED_REQUEST);
        assert_common_security_headers(ip_scan.headers());

        let good_host = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/meta")
                    .header("host", "panel.example.ts.net:443")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(good_host.status(), StatusCode::OK);

        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .header("host", "127.0.0.1:8080")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);

        // External client forwarded by a trusted proxy to /healthz with an unknown Host must be rejected
        let proxied_external_health = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .header("host", "203.0.113.99:8080")
                    .header("x-forwarded-for", "198.51.100.88")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            proxied_external_health.status(),
            StatusCode::MISDIRECTED_REQUEST
        );
    }

    #[tokio::test]
    async fn same_origin_guard_blocks_csrf_and_cookie_tossing_does_not_break_valid_session() {
        let cfg_toml = r#"
version = 1
[auth]
enabled = true
username = "admin"
password = "super-secret-password"
"#;
        let cfg = Config::from_toml_str(cfg_toml).unwrap();
        let state = AppState::new(Arc::new(cfg));
        let valid_token = state.auth.issue_session_token();
        let app = build_router(state);

        // 1. Cross-site Sec-Fetch-Site request to /api/* must return 403 Forbidden
        let cross_site = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/logout")
                    .header("host", "panel.example.com")
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_site.status(), StatusCode::FORBIDDEN);

        // 2. Forged Origin from another port or sibling subdomain to /api/speed/up must return 403 Forbidden
        let cross_origin = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/speed/up")
                    .header("host", "127.0.0.1:8080")
                    .header("origin", "http://127.0.0.1:3000")
                    .header("cookie", format!("pikbay_session={valid_token}"))
                    .body(Body::from("hello"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_origin.status(), StatusCode::FORBIDDEN);

        // 3. Valid same-origin request succeeds even when a sibling subdomain prepends a tossed bogus cookie
        let tossed_cookie = format!("pikbay_session=forged.bad.sig; pikbay_session={valid_token}");
        let same_origin_ok = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard")
                    .header("host", "panel.example.com")
                    .header("origin", "https://panel.example.com")
                    .header("sec-fetch-site", "same-origin")
                    .header("cookie", tossed_cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(same_origin_ok.status(), StatusCode::OK);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn icon_endpoint_rejects_symlinks_via_nofollow() {
        let tmp_dir = std::env::temp_dir().join(format!("pikbay_icon_sec_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let outside_file = std::env::temp_dir().join(format!("pikbay_secret_{}.svg", std::process::id()));
        std::fs::write(&outside_file, b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        let link_path = tmp_dir.join("linked.svg");
        std::os::unix::fs::symlink(&outside_file, &link_path).unwrap();

        let valid_cfg = format!(
            "version = 1\n[server]\nicons_dir = '{}'\n",
            tmp_dir.display()
        );
        let cfg = Config::from_toml_str(&valid_cfg).unwrap();
        let app = build_router(AppState::new(Arc::new(cfg)));

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/icons/linked.svg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_file(&outside_file);
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[tokio::test]
    async fn meta_and_api_404_never_fallback_to_html() {
        let app = build_router(sample_state());

        let meta_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/meta")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(meta_res.status(), StatusCode::OK);
        let bytes = meta_res.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(json["auth"]["enabled"], false);
        assert_eq!(json["auth"]["authenticated"], true);

        let missing_api = app
            .oneshot(
                Request::builder()
                    .uri("/api/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_api.status(), StatusCode::NOT_FOUND);
        assert!(missing_api
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("application/json"));
    }

    #[test]
    fn spa_fallback_and_asset_cache_headers() {
        let lookup = |path: &str| -> Option<Cow<'static, [u8]>> {
            match path {
                "index.html" => Some(Cow::Borrowed(b"<!doctype html><title>pikbay</title>")),
                "favicon.svg" => Some(Cow::Borrowed(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>")),
                "assets/favicon-a1b2c3.svg" => {
                    Some(Cow::Borrowed(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"))
                }
                "assets/icons-sprite-a1b2c3.svg" => {
                    Some(Cow::Borrowed(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"))
                }
                "assets/app-a1b2c3.js" => Some(Cow::Borrowed(b"console.log(1)")),
                _ => None,
            }
        };

        let fav = serve_with_provider(Method::GET, "/favicon.svg", lookup);
        assert_eq!(fav.status(), StatusCode::OK);
        assert_eq!(
            fav.headers().get("content-security-policy").unwrap(),
            crate::security::SVG_ICON_CSP_VALUE
        );

        let hashed_fav = serve_with_provider(Method::GET, "/assets/favicon-a1b2c3.svg", lookup);
        assert_eq!(hashed_fav.status(), StatusCode::OK);
        assert_eq!(
            hashed_fav.headers().get("content-security-policy").unwrap(),
            crate::security::SVG_ICON_CSP_VALUE
        );

        let sprite = serve_with_provider(Method::GET, "/assets/icons-sprite-a1b2c3.svg", lookup);
        assert_eq!(sprite.status(), StatusCode::OK);
        assert!(sprite.headers().get("content-security-policy").is_none());

        let hashed = serve_with_provider(Method::GET, "/assets/app-a1b2c3.js", lookup);
        assert_eq!(hashed.status(), StatusCode::OK);
        assert_eq!(
            hashed.headers().get("cache-control").unwrap(),
            "public, max-age=31536000, immutable"
        );

        let spa = serve_with_provider(Method::GET, "/tools/base64", lookup);
        assert_eq!(spa.status(), StatusCode::OK);
        assert_eq!(spa.headers().get("cache-control").unwrap(), "no-cache");

        let missing_js = serve_with_provider(Method::GET, "/assets/missing.js", lookup);
        assert_eq!(missing_js.status(), StatusCode::NOT_FOUND);
    }
}
