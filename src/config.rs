use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;

use crate::auth::hash_password_str;
use crate::security::IpNet;

/// Schema version supported by this binary.
pub const SUPPORTED_CONFIG_VERSION: u32 = 1;

pub const MAX_USERNAME_LEN: usize = 64;
pub const MIN_PASSWORD_CHARS: usize = 6;
pub const MAX_PASSWORD_BYTES: usize = 256;

const MAX_TITLE_LEN: usize = 64;
const MAX_GROUP_NAME_LEN: usize = 64;
const MAX_ITEM_NAME_LEN: usize = 80;
const MAX_DESCRIPTION_LEN: usize = 200;
const MAX_URL_LEN: usize = 2048;
const MAX_ICON_LEN: usize = 128;
const MAX_ICON_TEXT_CHARS: usize = 3;
const MAX_DISK_LABEL_LEN: usize = 48;

const ALLOWED_ICON_EXTENSIONS: &[&str] = &["svg", "png", "webp", "ico"];

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to read configuration file `{path}`: {source}")]
    ReadFile {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("TOML syntax or schema error ({location}): {message}")]
    ParseToml { location: String, message: String },
    #[error(
        "unsupported configuration version: found {found}, expected {expected} (check migration notes; legacy files are never modified automatically)"
    )]
    UnsupportedVersion { found: u32, expected: u32 },
    #[error("configuration validation failed: {0}")]
    Validation(String),
}

fn sanitize_toml_error(input: &str, err: &toml::de::Error) -> ConfigError {
    let location = if let Some(span) = err.span() {
        let safe_idx = span.start.min(input.len());
        let prefix = &input[..safe_idx];
        let line = prefix.bytes().filter(|&b| b == b'\n').count() + 1;
        let col = prefix
            .rsplit('\n')
            .next()
            .map(|s| s.chars().count() + 1)
            .unwrap_or(1);
        format!("line {line}, column {col}")
    } else {
        "unknown location".to_string()
    };
    // Report only the error category and line/column; never echo raw source lines that might contain passwords or hashes
    ConfigError::ParseToml {
        location,
        message: err.message().to_string(),
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub version: u32,
    pub server: ServerConfig,
    pub auth: AuthConfig,
    pub ui: UiConfig,
    pub system: SystemConfig,
    pub speedtest: SpeedtestConfig,
    pub groups: Vec<GroupConfig>,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub listen_addr: SocketAddr,
    pub trusted_proxies: Vec<IpNet>,
    pub allowed_hosts: Vec<String>,
    pub icons_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub enabled: bool,
    pub username: String,
    /// Argon2id PHC string (always populated when `enabled = true`).
    pub password_hash: Option<String>,
    pub session_ttl_hours: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiConfig {
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemConfig {
    pub enabled: bool,
    pub cpu: bool,
    pub per_core: bool,
    pub memory: bool,
    pub storage: bool,
    pub refresh_seconds: u64,
    pub disks: Vec<DiskConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiskConfig {
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeedtestConfig {
    pub enabled: bool,
    pub max_download_mb: u64,
    pub max_upload_mb: u64,
    pub per_ip_concurrency: usize,
    pub global_concurrency: usize,
    pub per_ip_requests_per_minute: u32,
    pub daily_quota_gb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupConfig {
    pub name: String,
    #[serde(default)]
    pub items: Vec<BookmarkItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookmarkItem {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Custom icon filename relative to `server.icons_dir` (e.g. `jellyfin.svg`; also accepts `file:jellyfin.svg`).
    #[serde(default)]
    pub icon: Option<String>,
    /// Optional fallback monogram text (1..=3 visible characters, e.g. `JF` or `NAS`).
    #[serde(default)]
    pub icon_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    version: u32,
    #[serde(default)]
    server: RawServerConfig,
    #[serde(default)]
    auth: RawAuthConfig,
    #[serde(default)]
    ui: RawUiConfig,
    #[serde(default)]
    system: RawSystemConfig,
    #[serde(default)]
    speedtest: RawSpeedtestConfig,
    #[serde(default)]
    groups: Vec<GroupConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawServerConfig {
    #[serde(default = "default_listen")]
    listen: String,
    #[serde(default = "default_trusted_proxies")]
    trusted_proxies: Vec<String>,
    #[serde(default)]
    allowed_hosts: Vec<String>,
    #[serde(default = "default_icons_dir")]
    icons_dir: PathBuf,
}

impl Default for RawServerConfig {
    fn default() -> Self {
        Self {
            listen: default_listen(),
            trusted_proxies: default_trusted_proxies(),
            allowed_hosts: Vec::new(),
            icons_dir: default_icons_dir(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAuthConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_username")]
    username: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    password_hash: Option<String>,
    #[serde(default = "default_session_ttl_hours")]
    session_ttl_hours: u64,
}

impl Default for RawAuthConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            username: default_username(),
            password: None,
            password_hash: None,
            session_ttl_hours: default_session_ttl_hours(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawUiConfig {
    #[serde(default = "default_title")]
    title: String,
}

impl Default for RawUiConfig {
    fn default() -> Self {
        Self {
            title: default_title(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSystemConfig {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_true")]
    cpu: bool,
    #[serde(default = "default_true")]
    per_core: bool,
    #[serde(default = "default_true")]
    memory: bool,
    #[serde(default = "default_true")]
    storage: bool,
    #[serde(default = "default_refresh_seconds")]
    refresh_seconds: u64,
    #[serde(default)]
    disks: Vec<DiskConfig>,
}

impl Default for RawSystemConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cpu: true,
            per_core: true,
            memory: true,
            storage: true,
            refresh_seconds: default_refresh_seconds(),
            disks: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSpeedtestConfig {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_max_download_mb")]
    max_download_mb: u64,
    #[serde(default = "default_max_upload_mb")]
    max_upload_mb: u64,
    #[serde(default = "default_per_ip_concurrency")]
    per_ip_concurrency: usize,
    #[serde(default = "default_global_concurrency")]
    global_concurrency: usize,
    #[serde(default = "default_per_ip_rpm")]
    per_ip_requests_per_minute: u32,
    #[serde(default = "default_daily_quota_gb")]
    daily_quota_gb: u64,
}

impl Default for RawSpeedtestConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_download_mb: default_max_download_mb(),
            max_upload_mb: default_max_upload_mb(),
            per_ip_concurrency: default_per_ip_concurrency(),
            global_concurrency: default_global_concurrency(),
            per_ip_requests_per_minute: default_per_ip_rpm(),
            daily_quota_gb: default_daily_quota_gb(),
        }
    }
}

fn default_listen() -> String {
    "127.0.0.1:8080".to_string()
}
fn default_trusted_proxies() -> Vec<String> {
    vec!["127.0.0.1/32".to_string(), "::1/128".to_string()]
}
fn default_icons_dir() -> PathBuf {
    PathBuf::from("./icons")
}
fn default_username() -> String {
    "admin".to_string()
}
fn default_session_ttl_hours() -> u64 {
    168
}
fn default_title() -> String {
    "pikbay".to_string()
}
fn default_true() -> bool {
    true
}
fn default_refresh_seconds() -> u64 {
    1
}
fn default_max_download_mb() -> u64 {
    256
}
fn default_max_upload_mb() -> u64 {
    64
}
fn default_per_ip_concurrency() -> usize {
    8
}
fn default_global_concurrency() -> usize {
    32
}
fn default_per_ip_rpm() -> u32 {
    600
}
fn default_daily_quota_gb() -> u64 {
    200
}

impl Config {
    pub fn from_file(path: &Path) -> Result<Self, ConfigError> {
        let content = fs::read_to_string(path).map_err(|source| ConfigError::ReadFile {
            path: path.display().to_string(),
            source,
        })?;
        let env_pw = std::env::var("PIKBAY_AUTH_PASSWORD")
            .ok()
            .filter(|s| !s.is_empty());
        let env_hash = std::env::var("PIKBAY_AUTH_PASSWORD_HASH")
            .ok()
            .filter(|s| !s.is_empty());
        let mut cfg = Self::from_toml_with_env(&content, env_pw.as_deref(), env_hash.as_deref())?;
        // Resolve relative `icons_dir` paths against the config file's parent directory so custom icons work regardless of CWD
        if cfg.server.icons_dir.is_relative() {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                cfg.server.icons_dir = parent.join(&cfg.server.icons_dir);
            }
        }
        Ok(cfg)
    }

    pub fn from_toml_str(input: &str) -> Result<Self, ConfigError> {
        Self::from_toml_with_env(input, None, None)
    }

    pub fn from_toml_with_env(
        input: &str,
        env_password: Option<&str>,
        env_password_hash: Option<&str>,
    ) -> Result<Self, ConfigError> {
        let raw: RawConfig = toml::from_str(input).map_err(|e| sanitize_toml_error(input, &e))?;

        if raw.version != SUPPORTED_CONFIG_VERSION {
            return Err(ConfigError::UnsupportedVersion {
                found: raw.version,
                expected: SUPPORTED_CONFIG_VERSION,
            });
        }

        let listen_addr: SocketAddr = raw.server.listen.parse().map_err(|e| {
            ConfigError::Validation(format!(
                "server.listen `{}` is not a valid socket address: {e}",
                raw.server.listen
            ))
        })?;

        let mut trusted_proxies = Vec::with_capacity(raw.server.trusted_proxies.len());
        for cidr in &raw.server.trusted_proxies {
            let net = IpNet::parse(cidr).map_err(|e| {
                ConfigError::Validation(format!("server.trusted_proxies `{cidr}` is invalid: {e}"))
            })?;
            trusted_proxies.push(net);
        }

        let mut allowed_hosts = Vec::with_capacity(raw.server.allowed_hosts.len());
        for raw_host in &raw.server.allowed_hosts {
            let normalized = normalize_allowed_host(raw_host).map_err(|reason| {
                ConfigError::Validation(format!(
                    "server.allowed_hosts `{raw_host}` is invalid: {reason}"
                ))
            })?;
            allowed_hosts.push(normalized);
        }

        if raw.server.icons_dir.as_os_str().is_empty() {
            return Err(ConfigError::Validation(
                "server.icons_dir must not be empty".to_string(),
            ));
        }

        let auth = build_auth_config(raw.auth, env_password, env_password_hash)?;

        let title = raw.ui.title.trim().to_string();
        if title.is_empty() || title.chars().count() > MAX_TITLE_LEN {
            return Err(ConfigError::Validation(format!(
                "ui.title must be between 1 and {MAX_TITLE_LEN} characters"
            )));
        }

        if raw.system.refresh_seconds == 0 || raw.system.refresh_seconds > 3600 {
            return Err(ConfigError::Validation(
                "system.refresh_seconds must be between 1 and 3600 seconds".to_string(),
            ));
        }

        for (idx, disk) in raw.system.disks.iter().enumerate() {
            if !Path::new(&disk.path).is_absolute() {
                return Err(ConfigError::Validation(format!(
                    "system.disks[{idx}].path `{}` must be an absolute path",
                    disk.path
                )));
            }
            let label_len = disk.label.trim().chars().count();
            if label_len == 0 || label_len > MAX_DISK_LABEL_LEN {
                return Err(ConfigError::Validation(format!(
                    "system.disks[{idx}].label must be between 1 and {MAX_DISK_LABEL_LEN} characters"
                )));
            }
        }

        if raw.speedtest.max_download_mb == 0 || raw.speedtest.max_download_mb > 4096 {
            return Err(ConfigError::Validation(
                "speedtest.max_download_mb must be between 1 and 4096".to_string(),
            ));
        }
        if raw.speedtest.max_upload_mb == 0 || raw.speedtest.max_upload_mb > 1024 {
            return Err(ConfigError::Validation(
                "speedtest.max_upload_mb must be between 1 and 1024".to_string(),
            ));
        }
        if raw.speedtest.per_ip_concurrency == 0 {
            return Err(ConfigError::Validation(
                "speedtest.per_ip_concurrency must be >= 1".to_string(),
            ));
        }
        if raw.speedtest.global_concurrency < raw.speedtest.per_ip_concurrency {
            return Err(ConfigError::Validation(
                "speedtest.global_concurrency must be >= per_ip_concurrency".to_string(),
            ));
        }
        if raw.speedtest.per_ip_requests_per_minute == 0 {
            return Err(ConfigError::Validation(
                "speedtest.per_ip_requests_per_minute must be >= 1".to_string(),
            ));
        }

        let mut normalized_groups = Vec::with_capacity(raw.groups.len());
        for (g_idx, mut group) in raw.groups.into_iter().enumerate() {
            group.name = group.name.trim().to_string();
            let g_len = group.name.chars().count();
            if g_len == 0 || g_len > MAX_GROUP_NAME_LEN {
                return Err(ConfigError::Validation(format!(
                    "groups[{g_idx}].name must be between 1 and {MAX_GROUP_NAME_LEN} characters"
                )));
            }
            for (i_idx, item) in group.items.iter_mut().enumerate() {
                normalize_and_validate_bookmark(g_idx, i_idx, item)?;
            }
            normalized_groups.push(group);
        }

        Ok(Self {
            version: raw.version,
            server: ServerConfig {
                listen_addr,
                trusted_proxies,
                allowed_hosts,
                icons_dir: raw.server.icons_dir,
            },
            auth,
            ui: UiConfig { title },
            system: SystemConfig {
                enabled: raw.system.enabled,
                cpu: raw.system.cpu,
                per_core: raw.system.per_core,
                memory: raw.system.memory,
                storage: raw.system.storage,
                refresh_seconds: raw.system.refresh_seconds,
                disks: raw.system.disks,
            },
            speedtest: SpeedtestConfig {
                enabled: raw.speedtest.enabled,
                max_download_mb: raw.speedtest.max_download_mb,
                max_upload_mb: raw.speedtest.max_upload_mb,
                per_ip_concurrency: raw.speedtest.per_ip_concurrency,
                global_concurrency: raw.speedtest.global_concurrency,
                per_ip_requests_per_minute: raw.speedtest.per_ip_requests_per_minute,
                daily_quota_gb: raw.speedtest.daily_quota_gb,
            },
            groups: normalized_groups,
        })
    }
}

fn build_auth_config(
    raw: RawAuthConfig,
    env_password: Option<&str>,
    env_password_hash: Option<&str>,
) -> Result<AuthConfig, ConfigError> {
    let username = raw.username.trim().to_string();
    if username.is_empty() || username.chars().count() > MAX_USERNAME_LEN {
        return Err(ConfigError::Validation(format!(
            "auth.username must be between 1 and {MAX_USERNAME_LEN} characters"
        )));
    }
    if raw.session_ttl_hours == 0 || raw.session_ttl_hours > 8760 {
        return Err(ConfigError::Validation(
            "auth.session_ttl_hours must be between 1 and 8760 hours".to_string(),
        ));
    }

    if !raw.enabled {
        return Ok(AuthConfig {
            enabled: false,
            username,
            password_hash: None,
            session_ttl_hours: raw.session_ttl_hours,
        });
    }

    // Count configured password sources so ambiguous multi-source setups fail fast
    let mut sources = 0usize;
    if env_password.is_some() {
        sources += 1;
    }
    if env_password_hash.is_some() {
        sources += 1;
    }
    if raw.password.is_some() {
        sources += 1;
    }
    if raw.password_hash.is_some() {
        sources += 1;
    }

    if sources == 0 {
        return Err(ConfigError::Validation(
            "a password source is required when auth.enabled = true (provide auth.password_hash, PIKBAY_AUTH_PASSWORD_HASH, PIKBAY_AUTH_PASSWORD, or auth.password)"
                .to_string(),
        ));
    }
    if sources > 1 {
        return Err(ConfigError::Validation(
            "conflicting password sources configured: supply only one of auth.password_hash, auth.password, PIKBAY_AUTH_PASSWORD, or PIKBAY_AUTH_PASSWORD_HASH"
                .to_string(),
        ));
    }

    let resolved_hash = if let Some(h) = env_password_hash.or(raw.password_hash.as_deref()) {
        let trimmed_hash = h.trim();
        let parsed = argon2::PasswordHash::new(trimmed_hash).map_err(|e| {
            ConfigError::Validation(format!(
                "auth.password_hash is not a valid Argon2 PHC string: {e}"
            ))
        })?;
        if !matches!(parsed.algorithm.as_str(), "argon2id" | "argon2i" | "argon2d")
            || parsed.hash.is_none()
            || parsed.salt.is_none()
        {
            return Err(ConfigError::Validation(
                "auth.password_hash is missing a complete Argon2 salt or digest segment".to_string(),
            ));
        }
        // Probe the verifier once at startup to validate m/t/p parameters so broken hashes never lock out login
        if let Err(err) = argon2::PasswordVerifier::verify_password(
            &argon2::Argon2::default(),
            b"__pikbay_startup_probe__",
            &parsed,
        ) {
            if err != argon2::password_hash::Error::Password {
                return Err(ConfigError::Validation(format!(
                    "auth.password_hash parameters are rejected by the Argon2 verifier: {err}"
                )));
            }
        }
        trimmed_hash.to_string()
    } else if let Some(pw) = env_password {
        if pw.chars().count() < MIN_PASSWORD_CHARS || pw.len() > MAX_PASSWORD_BYTES {
            return Err(ConfigError::Validation(format!(
                "PIKBAY_AUTH_PASSWORD must be at least {MIN_PASSWORD_CHARS} characters and at most {MAX_PASSWORD_BYTES} bytes"
            )));
        }
        hash_password_str(pw).map_err(ConfigError::Validation)?
    } else if let Some(ref pw) = raw.password {
        if pw.chars().count() < MIN_PASSWORD_CHARS || pw.len() > MAX_PASSWORD_BYTES {
            return Err(ConfigError::Validation(format!(
                "auth.password must be at least {MIN_PASSWORD_CHARS} characters and at most {MAX_PASSWORD_BYTES} bytes"
            )));
        }
        warn!(
            "plaintext auth.password detected in config file; hashed into Argon2id in memory. For long-lived deployments, restrict file permissions or generate auth.password_hash with `pikbay hash-password`"
        );
        hash_password_str(pw).map_err(ConfigError::Validation)?
    } else {
        unreachable!()
    };

    Ok(AuthConfig {
        enabled: true,
        username,
        password_hash: Some(resolved_hash),
        session_ttl_hours: raw.session_ttl_hours,
    })
}

fn normalize_and_validate_bookmark(
    g_idx: usize,
    i_idx: usize,
    item: &mut BookmarkItem,
) -> Result<(), ConfigError> {
    item.name = item.name.trim().to_string();
    let name_len = item.name.chars().count();
    if name_len == 0 || name_len > MAX_ITEM_NAME_LEN {
        return Err(ConfigError::Validation(format!(
            "groups[{g_idx}].items[{i_idx}].name must be between 1 and {MAX_ITEM_NAME_LEN} characters"
        )));
    }

    if let Some(ref mut desc) = item.description {
        *desc = desc.trim().to_string();
        if desc.chars().count() > MAX_DESCRIPTION_LEN {
            return Err(ConfigError::Validation(format!(
                "groups[{g_idx}].items[{i_idx}].description exceeds maximum length of {MAX_DESCRIPTION_LEN}"
            )));
        }
        if desc.is_empty() {
            item.description = None;
        }
    }

    validate_http_url(&item.url).map_err(|reason| {
        ConfigError::Validation(format!(
            "groups[{g_idx}].items[{i_idx}].url `{}` is invalid: {reason}",
            item.url
        ))
    })?;

    if let Some(raw_icon) = item.icon.take() {
        let trimmed = raw_icon.trim();
        if !trimmed.is_empty() {
            let filename = trimmed.strip_prefix("file:").unwrap_or(trimmed);
            if !is_safe_icon_filename(filename) {
                return Err(ConfigError::Validation(format!(
                    "groups[{g_idx}].items[{i_idx}].icon `{raw_icon}` is invalid: custom icon filenames allow only ASCII letters, digits, `.`, `_`, `-` with extension svg/png/webp/ico (no path traversal)"
                )));
            }
            item.icon = Some(filename.to_string());
        }
    }

    if let Some(raw_text) = item.icon_text.take() {
        let trimmed = raw_text.trim();
        if !trimmed.is_empty() {
            let count = trimmed.chars().count();
            if count > MAX_ICON_TEXT_CHARS || trimmed.chars().any(|c| c.is_control()) {
                return Err(ConfigError::Validation(format!(
                    "groups[{g_idx}].items[{i_idx}].icon_text must be 1..={MAX_ICON_TEXT_CHARS} printable characters"
                )));
            }
            item.icon_text = Some(trimmed.to_string());
        }
    }

    Ok(())
}

/// Validates a bookmark `http(s)://` URL.
pub fn validate_http_url(url: &str) -> Result<(), &'static str> {
    extract_url_host(url).map(|_| ())
}

/// Extracts the display `host[:port]` authority from a bookmark `http(s)://` URL.
pub fn extract_url_host(url: &str) -> Result<&str, &'static str> {
    if url.is_empty() || url.len() > MAX_URL_LEN {
        return Err("URL is empty or exceeds maximum length");
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("URL must not contain whitespace or control characters");
    }

    let rest = if let Some(r) = url.strip_prefix("https://") {
        r
    } else if let Some(r) = url.strip_prefix("http://") {
        r
    } else {
        return Err("only http:// or https:// URLs are allowed");
    };

    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        match host_port.find(']') {
            Some(end) if end > 1 => &host_port[1..end],
            _ => return Err("invalid IPv6 host literal"),
        }
    } else {
        host_port.split(':').next().unwrap_or("")
    };

    if host.is_empty() {
        return Err("missing hostname");
    }

    Ok(host_port)
}

/// Validates and normalizes a `server.allowed_hosts` entry (bare domain/IP or `host:port`, no scheme or path).
pub fn normalize_allowed_host(raw: &str) -> Result<String, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return Err("host must not be empty or exceed 255 characters");
    }
    if trimmed.contains("://") {
        return Err("specify a bare host (e.g. pikbay.example.com) without http:// or https://");
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '/' | '\\' | '?' | '#' | '@'))
    {
        return Err("host must not contain paths, whitespace, or URL delimiters");
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with('[') {
        let Some(end) = lower.find(']') else {
            return Err("IPv6 host literal is missing closing `]`");
        };
        if end <= 1 {
            return Err("IPv6 host literal must not be empty");
        }
        let tail = &lower[end + 1..];
        if !tail.is_empty() {
            let Some(port_str) = tail.strip_prefix(':') else {
                return Err("invalid suffix after IPv6 host literal");
            };
            port_str
                .parse::<u16>()
                .map_err(|_| "port must be in 1..=65535")?;
        }
    } else if let Some((host, port_str)) = lower.rsplit_once(':') {
        if host.is_empty() || host.contains(':') {
            return Err("invalid host:port format");
        }
        port_str
            .parse::<u16>()
            .map_err(|_| "port must be in 1..=65535")?;
    }

    Ok(lower)
}

/// Checks whether a `/icons/<file>` filename is traversal-free and uses an allowed image extension.
pub fn is_safe_icon_filename(name: &str) -> bool {
    if name.is_empty()
        || name.len() > MAX_ICON_LEN
        || name.starts_with('.')
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
    {
        return false;
    }

    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return false;
    }

    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if stem.is_empty() {
        return false;
    }
    ALLOWED_ICON_EXTENSIONS
        .iter()
        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_example_config() {
        let example = include_str!("../config.example.toml");
        let cfg = Config::from_toml_str(example).expect("config.example.toml must be valid");
        assert_eq!(cfg.version, 1);
        assert_eq!(cfg.ui.title, "pikbay");
        assert!(!cfg.auth.enabled);
        assert_eq!(cfg.server.icons_dir, PathBuf::from("./icons"));
        assert!(cfg.system.per_core);
        assert_eq!(cfg.speedtest.per_ip_requests_per_minute, 600);
        assert_eq!(cfg.groups.len(), 2);
        assert_eq!(cfg.groups[0].items[0].icon_text.as_deref(), Some("JF"));
    }

    #[test]
    fn validates_auth_config_and_conflicts() {
        let missing_pw = r#"
version = 1
[auth]
enabled = true
username = "admin"
"#;
        assert!(Config::from_toml_str(missing_pw).is_err());

        let valid_pw = r#"
version = 1
[auth]
enabled = true
username = "admin"
password = "strong-secret-password"
"#;
        let cfg =
            Config::from_toml_str(valid_pw).expect("valid plaintext password should hash in memory");
        assert!(cfg.auth.enabled);
        assert!(cfg
            .auth
            .password_hash
            .as_deref()
            .unwrap()
            .starts_with("$argon2id$"));

        // Supplying both config file password and env password must fail fast to avoid ambiguity
        assert!(Config::from_toml_with_env(valid_pw, Some("another-secret"), None).is_err());

        // Incomplete PHC hash (missing digest segment) must be rejected at startup
        let incomplete_phc = r#"
version = 1
[auth]
enabled = true
username = "admin"
password_hash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ"
"#;
        assert!(Config::from_toml_str(incomplete_phc).is_err());

        // Syntax errors must report line/column without echoing raw lines containing secrets
        let malformed = "version = 1\n[auth]\npassword = \"SuperSecretLeak999\" bad_tail\n";
        let msg = Config::from_toml_str(malformed).unwrap_err().to_string();
        assert!(!msg.contains("SuperSecretLeak999"));
        assert!(msg.contains("line 3"));
    }

    #[test]
    fn rejects_wrong_version_and_unknown_fields() {
        let err = Config::from_toml_str("version = 2\n").unwrap_err();
        assert!(matches!(
            err,
            ConfigError::UnsupportedVersion {
                found: 2,
                expected: 1
            }
        ));

        let err2 = Config::from_toml_str("version = 1\nunexpected_key = true\n").unwrap_err();
        assert!(matches!(err2, ConfigError::ParseToml { .. }));
    }

    #[test]
    fn normalizes_and_validates_icons_and_urls() {
        let compat_icon = r#"
version = 1
[[groups]]
name = "Lab"
[[groups.items]]
name = "Jellyfin"
url = "https://example.com:8443/app"
icon = "file:jellyfin_logo.svg"
icon_text = "JF"
"#;
        let cfg = Config::from_toml_str(compat_icon).unwrap();
        assert_eq!(
            cfg.groups[0].items[0].icon.as_deref(),
            Some("jellyfin_logo.svg")
        );
        assert_eq!(cfg.groups[0].items[0].icon_text.as_deref(), Some("JF"));
        assert_eq!(
            extract_url_host(&cfg.groups[0].items[0].url).unwrap(),
            "example.com:8443"
        );

        let bad_icon = r#"
version = 1
[[groups]]
name = "Lab"
[[groups.items]]
name = "Traversal"
url = "https://example.com"
icon = "../etc/passwd"
"#;
        assert!(Config::from_toml_str(bad_icon).is_err());
        assert!(!is_safe_icon_filename(".hidden.svg"));
        assert!(!is_safe_icon_filename("script.js"));
    }
}
