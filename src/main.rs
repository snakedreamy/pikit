#![forbid(unsafe_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use pikbay::app::{build_router, AppState};
use pikbay::auth::run_hash_password_cli;
use pikbay::config::Config;
use pikbay::system::spawn_system_sampler;
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

fn init_tracing() {
    let filter = EnvFilter::try_from_env("PIKBAY_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

fn resolve_config_path() -> PathBuf {
    if let Ok(path) = std::env::var("PIKBAY_CONFIG") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    PathBuf::from("./config.toml")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            error!("failed to listen for SIGINT: {err}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(err) => {
                error!("failed to listen for SIGTERM: {err}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("received SIGINT, starting graceful shutdown"),
        _ = terminate => info!("received SIGTERM, starting graceful shutdown"),
    }
}

/// Maximum grace period granted to detached background threads (such as an isolated `statvfs`
/// probe stuck on an unresponsive network mount) after HTTP connections have finished draining.
const RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    if let Some(sub) = args.next() {
        match sub.as_str() {
            "hash-password" => {
                if let Err(err) = run_hash_password_cli() {
                    eprintln!("Error: {err}");
                    return ExitCode::FAILURE;
                }
                return ExitCode::SUCCESS;
            }
            "--version" | "-V" => {
                println!(
                    "pikbay {} ({})",
                    env!("CARGO_PKG_VERSION"),
                    env!("PIKBAY_BUILD_COMMIT")
                );
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!(
                    "Unknown argument `{other}`. Supported commands: `pikbay hash-password` or `--version`"
                );
                return ExitCode::FAILURE;
            }
        }
    }

    init_tracing();

    let config_path = resolve_config_path();
    let config = match Config::from_file(&config_path) {
        Ok(cfg) => cfg,
        Err(err) => {
            error!(
                path = %config_path.display(),
                error = %err,
                "failed to load configuration; aborting startup"
            );
            return ExitCode::FAILURE;
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            error!(error = %err, "failed to initialize Tokio runtime");
            return ExitCode::FAILURE;
        }
    };

    let exit_code = runtime.block_on(run_server(config, config_path));
    runtime.shutdown_timeout(RUNTIME_SHUTDOWN_TIMEOUT);
    exit_code
}

async fn run_server(config: Config, config_path: PathBuf) -> ExitCode {
    let listen_addr: SocketAddr = config.server.listen_addr;
    let auth_enabled = config.auth.enabled;
    let state = AppState::new(Arc::new(config));

    // Start background hardware telemetry sampler tasks
    spawn_system_sampler(Arc::clone(&state.system));

    // Periodically evict expired per-IP rate-limiter buckets, idle speedtest semaphores, and expired drop rooms
    {
        let auth_cleaner = Arc::clone(&state.auth);
        let speed_cleaner = Arc::clone(&state.speedtest);
        let drop_cleaner = Arc::clone(&state.drop);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                auth_cleaner.retain_recent_limiters();
                speed_cleaner.retain_recent();
                drop_cleaner.retain_recent();
            }
        });
    }

    let router = build_router(state);

    let listener = match TcpListener::bind(listen_addr).await {
        Ok(l) => l,
        Err(err) => {
            error!(listen = %listen_addr, error = %err, "failed to bind TCP listener");
            return ExitCode::FAILURE;
        }
    };

    info!(
        version = env!("CARGO_PKG_VERSION"),
        commit = env!("PIKBAY_BUILD_COMMIT"),
        listen = %listen_addr,
        auth = auth_enabled,
        config = %config_path.display(),
        "pikbay started"
    );

    if let Err(err) = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    {
        error!(error = %err, "HTTP server terminated with error");
        return ExitCode::FAILURE;
    }

    info!("pikbay stopped cleanly");
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_shutdown_timeout_does_not_hang_on_blocked_worker() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async {
            tokio::task::spawn_blocking(|| {
                std::thread::sleep(Duration::from_secs(10));
            });
            tokio::time::sleep(Duration::from_millis(15)).await;
        });

        let start = std::time::Instant::now();
        rt.shutdown_timeout(Duration::from_millis(60));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
