pub mod cgroup;
pub mod cpu;
pub mod disk;
pub mod memory;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::app::AppState;
use crate::config::SystemConfig;
use cgroup::{detect_cgroup_context, CgroupContext};
use cpu::{capture_cpu_point, compute_cpu_delta, CpuSamplePoint, CpuTelemetryDto};
use disk::{sample_disks, DiskTelemetryDto};
use memory::{sample_memory, MemoryTelemetryDto};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTelemetryResponse {
    pub refresh_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<CpuTelemetryDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryTelemetryDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub disks: Vec<DiskTelemetryDto>,
}

#[derive(Serialize)]
struct SystemErrorBody {
    error: &'static str,
    message: &'static str,
}

/// Hardware telemetry sampler:
/// - Never blocks server startup on `statvfs` disk probes (so stale NFS/SMB mounts cannot stall `/healthz` or TCP bind);
/// - Isolates microsecond-scale `/proc` CPU/memory sampling from potentially blocking storage probes at runtime.
pub struct SystemService {
    cfg: SystemConfig,
    cgroup_ctx: CgroupContext,
    snapshot: RwLock<SystemTelemetryResponse>,
    prev_cpu: RwLock<Option<CpuSamplePoint>>,
    disk_probe_running: AtomicBool,
}

impl SystemService {
    pub fn new(cfg: &SystemConfig) -> Self {
        let cgroup_ctx = detect_cgroup_context();
        let initial_cpu_pt = if cfg.enabled && cfg.cpu {
            Some(capture_cpu_point(&cgroup_ctx, cfg.per_core))
        } else {
            None
        };

        let initial_mem = if cfg.enabled && cfg.memory {
            sample_memory(&cgroup_ctx)
        } else {
            None
        };

        Self {
            cfg: cfg.clone(),
            cgroup_ctx,
            snapshot: RwLock::new(SystemTelemetryResponse {
                refresh_seconds: cfg.refresh_seconds,
                cpu: None,
                memory: initial_mem,
                disks: Vec::new(),
            }),
            prev_cpu: RwLock::new(initial_cpu_pt),
            disk_probe_running: AtomicBool::new(false),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.cfg.enabled
    }

    pub fn refresh_seconds(&self) -> u64 {
        self.cfg.refresh_seconds
    }

    pub fn storage_enabled(&self) -> bool {
        self.cfg.enabled && self.cfg.storage
    }

    /// Refreshes kernel-memory CPU and RAM metrics only (never touches mounted filesystems).
    pub fn sample_cpu_and_memory(&self) {
        if !self.cfg.enabled {
            return;
        }

        let cpu_dto = if self.cfg.cpu {
            let curr_pt = capture_cpu_point(&self.cgroup_ctx, self.cfg.per_core);
            let mut prev_guard = self.prev_cpu.write().expect("prev_cpu rwlock poisoned");
            let computed = prev_guard
                .as_ref()
                .and_then(|prev| compute_cpu_delta(prev, &curr_pt, self.cfg.per_core));
            *prev_guard = Some(curr_pt);
            computed
        } else {
            None
        };

        let mem_dto = if self.cfg.memory {
            sample_memory(&self.cgroup_ctx)
        } else {
            None
        };

        let mut snap = self
            .snapshot
            .write()
            .expect("system snapshot rwlock poisoned");
        if cpu_dto.is_some() || !self.cfg.cpu {
            snap.cpu = cpu_dto;
        }
        snap.memory = mem_dto;
    }

    /// Refreshes disk metrics independently; skips the tick if a previous probe is still blocked in the kernel
    /// on an unresponsive network mount so the blocking thread pool cannot pile up.
    pub fn sample_disks_isolated(&self) {
        if !self.storage_enabled() {
            return;
        }
        if self
            .disk_probe_running
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        struct ResetFlag<'a>(&'a AtomicBool);
        impl Drop for ResetFlag<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _guard = ResetFlag(&self.disk_probe_running);

        let disks_dto = sample_disks(&self.cfg.disks);
        let mut snap = self
            .snapshot
            .write()
            .expect("system snapshot rwlock poisoned");
        snap.disks = disks_dto;
    }

    /// Triggers a synchronous full sample snapshot for integration tests.
    pub fn sample_once(&self) {
        self.sample_cpu_and_memory();
        self.sample_disks_isolated();
    }

    pub fn current_snapshot(&self) -> SystemTelemetryResponse {
        self.snapshot
            .read()
            .expect("system snapshot rwlock poisoned")
            .clone()
    }
}

/// Spawns dual background sampling loops: CPU/memory and storage run on independent channels so slow mounts
/// never block startup or delay CPU/RAM updates.
pub fn spawn_system_sampler(service: Arc<SystemService>) {
    if !service.is_enabled() {
        return;
    }
    let refresh = Duration::from_secs(service.refresh_seconds().max(1));

    // Channel 1: isolated async disk probing (immediate initial probe, then every max(refresh, 2s))
    if service.storage_enabled() {
        let disk_svc = Arc::clone(&service);
        let disk_interval = refresh.max(Duration::from_secs(2));
        tokio::spawn(async move {
            let init_svc = Arc::clone(&disk_svc);
            let _ = tokio::task::spawn_blocking(move || init_svc.sample_disks_isolated()).await;

            let mut ticker = tokio::time::interval(disk_interval);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let svc = Arc::clone(&disk_svc);
                // Fire without awaiting stalled probes; `disk_probe_running` guarantees at most one in-flight worker
                tokio::task::spawn_blocking(move || svc.sample_disks_isolated());
            }
        });
    }

    // Channel 2: high-frequency CPU and memory sampling (120ms initial delta, then every `refresh_seconds`)
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(120)).await;
        let svc_init = Arc::clone(&service);
        let _ = tokio::task::spawn_blocking(move || svc_init.sample_cpu_and_memory()).await;

        let mut ticker = tokio::time::interval(refresh);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let svc = Arc::clone(&service);
            let _ = tokio::task::spawn_blocking(move || svc.sample_cpu_and_memory()).await;
        }
    });
}

/// `GET /api/system`
pub async fn get_system(State(state): State<AppState>) -> Response {
    if !state.system.is_enabled() {
        return (
            StatusCode::NOT_FOUND,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(SystemErrorBody {
                error: "disabled",
                message: "Hardware telemetry is disabled in configuration",
            }),
        )
            .into_response();
    }

    let payload = state.system.current_snapshot();
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(payload),
    )
        .into_response()
}
