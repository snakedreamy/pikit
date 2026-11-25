use std::borrow::Cow;

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use rust_embed::RustEmbed;

use crate::security::SVG_ICON_CSP_VALUE;

#[derive(RustEmbed)]
#[folder = "web/dist"]
struct EmbeddedAssets;

const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";
const NO_CACHE: &str = "no-cache";
const NO_STORE: &str = "no-store";

/// Serves embedded frontend assets and handles SPA History API fallback routes.
pub async fn serve_embedded(method: Method, uri: Uri) -> Response {
    serve_with_provider(method, uri.path(), |path| {
        EmbeddedAssets::get(path).map(|f| f.data)
    })
}

/// Asset-serving core parameterized over a lookup closure so unit tests can cover all branches.
pub fn serve_with_provider<F>(method: Method, raw_path: &str, lookup: F) -> Response
where
    F: Fn(&str) -> Option<Cow<'static, [u8]>>,
{
    if method != Method::GET && method != Method::HEAD {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [
                (header::ALLOW, HeaderValue::from_static("GET, HEAD")),
                (header::CACHE_CONTROL, HeaderValue::from_static(NO_STORE)),
            ],
            "Method Not Allowed",
        )
            .into_response();
    }

    let trimmed = raw_path.trim_start_matches('/');
    if !is_safe_asset_path(trimmed) {
        return not_found_response();
    }

    let target = if trimmed.is_empty() {
        "index.html"
    } else {
        trimmed
    };

    if let Some(bytes) = lookup(target) {
        return build_asset_response(&method, target, bytes);
    }

    // Return 404 directly for missing files with extensions so `nosniff` never sees HTML for JS/CSS
    let last_segment = target.rsplit('/').next().unwrap_or(target);
    if last_segment.contains('.') {
        return not_found_response();
    }

    // Extensionless SPA routes fall back to index.html for client-side routing
    if let Some(index_bytes) = lookup("index.html") {
        return build_asset_response(&method, "index.html", index_bytes);
    }

    not_found_response()
}

fn is_safe_asset_path(path: &str) -> bool {
    if path.contains('\\') || path.contains('\0') {
        return false;
    }
    for segment in path.split('/') {
        if segment == ".." {
            return false;
        }
    }
    true
}

fn content_type_for(path: &str) -> String {
    if path.ends_with(".webmanifest") {
        return "application/manifest+json".to_string();
    }
    if path.ends_with(".html") {
        return "text/html; charset=utf-8".to_string();
    }
    if path.ends_with(".js") || path.ends_with(".mjs") {
        return "text/javascript; charset=utf-8".to_string();
    }
    if path.ends_with(".css") {
        return "text/css; charset=utf-8".to_string();
    }
    if path.ends_with(".svg") {
        return "image/svg+xml".to_string();
    }
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

fn cache_control_for(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        IMMUTABLE_CACHE
    } else {
        NO_CACHE
    }
}

fn build_asset_response(method: &Method, path: &str, bytes: Cow<'static, [u8]>) -> Response {
    let content_type = content_type_for(path);
    let cache_control = cache_control_for(path);
    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        match bytes {
            // Wrap embedded static slices zero-copy via `Bytes::from_static` to avoid per-request heap allocation
            Cow::Borrowed(static_slice) => Body::from(Bytes::from_static(static_slice)),
            Cow::Owned(vec) => Body::from(vec),
        }
    };

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control);

    // Attach sandboxed SVG CSP to standalone brand SVGs (`/assets/favicon-*.svg`, `/favicon.svg`, `/logo.svg`)
    // so internal `prefers-color-scheme` `<style>` rules work while blocking scripts; keep `assets/icons-sprite-*.svg`
    // under the primary document CSP for `<use>` sprite compatibility.
    if path.ends_with(".svg") && !path.starts_with("assets/icons-sprite-") {
        builder = builder.header(
            "content-security-policy",
            HeaderValue::from_static(SVG_ICON_CSP_VALUE),
        );
    }

    builder.body(body).unwrap_or_else(|_| not_found_response())
}

fn not_found_response() -> Response {
    (
        StatusCode::NOT_FOUND,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static(NO_STORE)),
        ],
        "Not Found",
    )
        .into_response()
}
