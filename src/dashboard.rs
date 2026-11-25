use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::app::AppState;
use crate::config::{extract_url_host, is_safe_icon_filename};
use crate::security::SVG_ICON_CSP_VALUE;

/// Maximum allowed size per custom bookmark icon file (`512 KiB`).
const MAX_ICON_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub groups: Vec<DashboardGroupDto>,
}

#[derive(Debug, Serialize)]
pub struct DashboardGroupDto {
    pub name: String,
    pub items: Vec<DashboardItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardItemDto {
    pub name: String,
    pub url: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_text: Option<String>,
}

/// `GET /api/dashboard` returns validated bookmark groups and items.
pub async fn get_dashboard(State(state): State<AppState>) -> Response {
    let groups = state
        .config
        .groups
        .iter()
        .map(|g| DashboardGroupDto {
            name: g.name.clone(),
            items: g
                .items
                .iter()
                .map(|item| DashboardItemDto {
                    name: item.name.clone(),
                    url: item.url.clone(),
                    host: extract_url_host(&item.url).unwrap_or("").to_string(),
                    description: item.description.clone(),
                    icon_url: item.icon.as_ref().map(|f| format!("/icons/{f}")),
                    icon_text: item.icon_text.clone(),
                })
                .collect(),
        })
        .collect();

    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(DashboardResponse { groups }),
    )
        .into_response()
}

/// `GET /icons/{filename}` serves custom bookmark icons read-only from `server.icons_dir`.
/// Security guarantees:
/// 1. Strict filename allowlist (no path separators, no `..`, no dot-files, limited to svg/png/webp/ico).
/// 2. `O_NOFOLLOW` on Unix rejects symlinks atomically without TOCTOU races.
/// 3. `.svg` responses carry `SVG_ICON_CSP_VALUE` (`sandbox`) and are rendered strictly via `<img>`.
pub async fn get_icon(
    State(state): State<AppState>,
    AxumPath(filename): AxumPath<String>,
) -> Response {
    if !is_safe_icon_filename(&filename) {
        return icon_not_found();
    }

    let path = state.config.server.icons_dir.join(&filename);
    let read_res = tokio::task::spawn_blocking(move || read_icon_no_follow(&path)).await;
    let Ok(Some(bytes)) = read_res else {
        return icon_not_found();
    };

    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or_default();

    let (content_type, is_svg) = if ext.eq_ignore_ascii_case("svg") {
        ("image/svg+xml", true)
    } else if ext.eq_ignore_ascii_case("png") {
        ("image/png", false)
    } else if ext.eq_ignore_ascii_case("webp") {
        ("image/webp", false)
    } else {
        ("image/x-icon", false)
    };

    let mut res = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=3600"),
            ),
        ],
        bytes,
    )
        .into_response();

    if is_svg {
        res.headers_mut().insert(
            "content-security-policy",
            HeaderValue::from_static(SVG_ICON_CSP_VALUE),
        );
    }

    res
}

/// Opens an icon file with `O_NOFOLLOW` (on Unix) and verifies regular-file type and size cap on the open descriptor.
fn read_icon_no_follow(path: &std::path::Path) -> Option<Vec<u8>> {
    use std::io::Read;

    let mut opts = std::fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    }

    let file = opts.open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > MAX_ICON_FILE_BYTES {
        return None;
    }

    let cap = (meta.len() as usize).min(MAX_ICON_FILE_BYTES as usize);
    let mut buf = Vec::with_capacity(cap);
    file.take(MAX_ICON_FILE_BYTES + 1).read_to_end(&mut buf).ok()?;
    if buf.is_empty() || (buf.len() as u64) > MAX_ICON_FILE_BYTES {
        return None;
    }
    Some(buf)
}

fn icon_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        "icon not found",
    )
        .into_response()
}
