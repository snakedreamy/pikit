use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::app::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaResponse {
    pub version: &'static str,
    pub commit: &'static str,
    pub title: String,
    pub auth: AuthMeta,
    pub features: EnabledFeatures,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speedtest_limits: Option<SpeedtestLimitsMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_limits: Option<DropLimitsMeta>,
}

#[derive(Debug, Serialize)]
pub struct AuthMeta {
    pub enabled: bool,
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledFeatures {
    pub system: bool,
    pub per_core: bool,
    pub speedtest: bool,
    pub drop: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedtestLimitsMeta {
    pub max_download_mb: u64,
    pub max_upload_mb: u64,
    pub max_streams: usize,
    pub requests_per_minute: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropLimitsMeta {
    pub code_ttl_seconds: u64,
    pub max_relay_mb: u64,
}

/// `GET /healthz` liveness probe.
pub async fn healthz() -> Response {
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        "ok",
    )
        .into_response()
}

/// `GET /api/meta` returns runtime version, UI title, authentication state, and enabled feature flags.
/// When authentication is enabled and the caller is unauthenticated, internal build commit, speedtest caps,
/// and feature flags are omitted.
pub async fn get_meta(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let cfg = &state.config;
    let auth_enabled = state.auth.is_enabled();
    let authenticated = state.auth.is_request_authenticated(&headers);

    let payload = if auth_enabled && !authenticated {
        MetaResponse {
            version: env!("CARGO_PKG_VERSION"),
            commit: "",
            title: cfg.ui.title.clone(),
            auth: AuthMeta {
                enabled: true,
                authenticated: false,
                username: None,
            },
            features: EnabledFeatures {
                system: false,
                per_core: false,
                speedtest: false,
                drop: false,
            },
            speedtest_limits: None,
            drop_limits: None,
        }
    } else {
        let speedtest_limits = cfg.speedtest.enabled.then(|| SpeedtestLimitsMeta {
            max_download_mb: cfg.speedtest.max_download_mb,
            max_upload_mb: cfg.speedtest.max_upload_mb,
            max_streams: cfg
                .speedtest
                .per_ip_concurrency
                .min(cfg.speedtest.global_concurrency)
                .clamp(1, 8),
            requests_per_minute: cfg.speedtest.per_ip_requests_per_minute,
        });
        let drop_limits = cfg.drop.enabled.then(|| DropLimitsMeta {
            code_ttl_seconds: cfg.drop.code_ttl_seconds,
            max_relay_mb: cfg.drop.max_relay_mb,
        });

        MetaResponse {
            version: env!("CARGO_PKG_VERSION"),
            commit: env!("PIKBAY_BUILD_COMMIT"),
            title: cfg.ui.title.clone(),
            auth: AuthMeta {
                enabled: auth_enabled,
                authenticated: true,
                username: auth_enabled.then(|| state.auth.configured_username().to_string()),
            },
            features: EnabledFeatures {
                system: cfg.system.enabled,
                per_core: cfg.system.per_core,
                speedtest: cfg.speedtest.enabled,
                drop: cfg.drop.enabled,
            },
            speedtest_limits,
            drop_limits,
        }
    };

    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(payload),
    )
        .into_response()
}
