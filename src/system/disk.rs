use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::DiskConfig;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskTelemetryDto {
    pub label: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs_type: Option<String>,
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountCandidate {
    pub mount_point: String,
    pub fs_type: String,
    pub source: String,
    pub writable: bool,
}

const IGNORED_FS_TYPES: &[&str] = &[
    "proc",
    "sysfs",
    "tmpfs",
    "devtmpfs",
    "devpts",
    "cgroup",
    "cgroup2",
    "pstore",
    "bpf",
    "tracefs",
    "debugfs",
    "securityfs",
    "configfs",
    "fusectl",
    "hugetlbfs",
    "mqueue",
    "autofs",
    "binfmt_misc",
    "nsfs",
    "ramfs",
    "squashfs",
    "iso9660",
    "udf",
    "rpc_pipefs",
    "efivarfs",
    "overlay",
    "fuse.portal",
    "fuse.gvfsd-fuse",
];

const NETWORK_OR_POOL_FS: &[&str] = &[
    "zfs",
    "nfs",
    "nfs4",
    "cifs",
    "smb3",
    "virtiofs",
    "9p",
    "fuse.sshfs",
    "fuse.rclone",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiskProbeScope {
    All,
    LocalOnly,
    NetworkOnly,
}

pub fn is_network_fs_type(fs_type: &str) -> bool {
    matches!(
        fs_type,
        "nfs"
            | "nfs4"
            | "cifs"
            | "smb3"
            | "9p"
            | "fuse.sshfs"
            | "fuse.rclone"
            | "ceph"
            | "glusterfs"
    )
}

fn scope_matches_fs(scope: DiskProbeScope, is_net: bool) -> bool {
    match scope {
        DiskProbeScope::All => true,
        DiskProbeScope::LocalOnly => !is_net,
        DiskProbeScope::NetworkOnly => is_net,
    }
}

const MAX_SYMLINK_HOPS: usize = 16;

/// Samples storage telemetry within `scope`: probes `[[system.disks]]` when explicitly configured,
/// otherwise auto-discovers and deduplicates real mounted disks on the host or container.
pub fn sample_disks_scoped(
    configured: &[DiskConfig],
    scope: DiskProbeScope,
) -> Vec<DiskTelemetryDto> {
    if !configured.is_empty() {
        let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
        return configured
            .iter()
            .filter(|d| {
                let is_net = is_configured_path_on_network_mount_with(&mountinfo, &d.path, |p| {
                    std::fs::read_link(p).ok()
                });
                scope_matches_fs(scope, is_net)
            })
            .map(sample_single_disk)
            .collect();
    }
    discover_and_sample_disks(scope)
}

enum PosixStep {
    Parent,
    Normal(String),
}

fn format_posix_path(stack: &[String]) -> String {
    if stack.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", stack.join("/"))
    }
}

fn push_posix_steps_front(raw: &str, queue: &mut std::collections::VecDeque<PosixStep>) {
    let steps: Vec<PosixStep> = raw
        .split('/')
        .filter_map(|seg| match seg {
            "" | "." => None,
            ".." => Some(PosixStep::Parent),
            s => Some(PosixStep::Normal(s.to_string())),
        })
        .collect();
    for step in steps.into_iter().rev() {
        queue.push_front(step);
    }
}

/// Classifies whether `raw_path` targets or traverses a network mount in exact kernel VFS order
/// without ever invoking syscalls inside a remote filesystem: resolves symlinks before subsequent
/// `..` segments while on local mounts, and returns `true` the instant resolution touches a network
/// mount prefix in `mountinfo`. Uses pure POSIX `/` formatting so unit tests behave identically on Windows.
fn is_configured_path_on_network_mount_with<F>(
    mountinfo: &str,
    raw_path: &str,
    mut read_link_fn: F,
) -> bool
where
    F: FnMut(&Path) -> Option<PathBuf>,
{
    if mountinfo.trim().is_empty() {
        return false;
    }
    if is_path_on_network_mount(mountinfo, "/") {
        return true;
    }

    let mut stack: Vec<String> = Vec::new();
    let mut queue = std::collections::VecDeque::new();
    push_posix_steps_front(raw_path, &mut queue);
    let mut symlink_hops = 0usize;

    while let Some(step) = queue.pop_front() {
        match step {
            PosixStep::Parent => {
                stack.pop();
                let cur = format_posix_path(&stack);
                if is_path_on_network_mount(mountinfo, &cur) {
                    return true;
                }
            }
            PosixStep::Normal(seg) => {
                stack.push(seg);
                let cur = format_posix_path(&stack);
                if is_path_on_network_mount(mountinfo, &cur) {
                    return true;
                }

                if let Some(link_target) = read_link_fn(Path::new(&cur)) {
                    symlink_hops += 1;
                    if symlink_hops > MAX_SYMLINK_HOPS {
                        return false;
                    }
                    let target_posix = link_target.to_string_lossy().replace('\\', "/");
                    if target_posix.starts_with('/') {
                        stack.clear();
                    } else {
                        stack.pop();
                    }
                    push_posix_steps_front(&target_posix, &mut queue);
                }
            }
        }
    }

    let final_path = format_posix_path(&stack);
    is_path_on_network_mount(mountinfo, &final_path)
}

fn is_path_on_network_mount(mountinfo: &str, target_path: &str) -> bool {
    let mut best_len = 0usize;
    let mut best_is_net = false;
    for line in mountinfo.lines() {
        let Some((left, right)) = line.split_once(" - ") else {
            continue;
        };
        let left_fields: Vec<&str> = left.split_whitespace().collect();
        let right_fields: Vec<&str> = right.split_whitespace().collect();
        if left_fields.len() < 6 || right_fields.len() < 2 {
            continue;
        }
        let mp = unescape_mount_path(left_fields[4]);
        let fs_type = right_fields[0];
        let matches_prefix = if mp == "/" {
            target_path.starts_with('/')
        } else {
            target_path == mp
                || target_path
                    .strip_prefix(&mp)
                    .is_some_and(|rest| rest.starts_with('/'))
        };
        if matches_prefix && mp.len() >= best_len {
            best_len = mp.len();
            best_is_net = is_network_fs_type(fs_type);
        }
    }
    best_is_net
}

pub fn sample_single_disk(disk: &DiskConfig) -> DiskTelemetryDto {
    match statvfs_metrics(&disk.path) {
        Ok(m) => DiskTelemetryDto {
            label: disk.label.clone(),
            path: disk.path.clone(),
            device: None,
            fs_type: None,
            used_bytes: m.used_bytes,
            total_bytes: m.total_bytes,
            available_bytes: m.available_bytes,
            percent: m.percent,
            error: None,
        },
        Err(err) => DiskTelemetryDto {
            label: disk.label.clone(),
            path: disk.path.clone(),
            device: None,
            fs_type: None,
            used_bytes: 0,
            total_bytes: 0,
            available_bytes: 0,
            percent: 0.0,
            error: Some(err),
        },
    }
}

struct StatVfsMetrics {
    fsid: u64,
    blocks: u64,
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
    percent: f64,
}

#[cfg(unix)]
fn statvfs_metrics(path: &str) -> Result<StatVfsMetrics, String> {
    let st = rustix::fs::statvfs(path).map_err(|e| e.to_string())?;
    let block_size = if st.f_frsize > 0 {
        st.f_frsize as u64
    } else {
        st.f_bsize as u64
    };
    let blocks = st.f_blocks as u64;
    let total_bytes = blocks.saturating_mul(block_size);
    let free_bytes = (st.f_bfree as u64).saturating_mul(block_size);
    let available_bytes = (st.f_bavail as u64).saturating_mul(block_size);
    let used_bytes = total_bytes.saturating_sub(free_bytes);
    let percent = if total_bytes > 0 {
        round1(((used_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0))
    } else {
        0.0
    };
    Ok(StatVfsMetrics {
        fsid: st.f_fsid,
        blocks,
        total_bytes,
        used_bytes,
        available_bytes,
        percent,
    })
}

#[cfg(not(unix))]
fn statvfs_metrics(_path: &str) -> Result<StatVfsMetrics, String> {
    Err("statvfs disk telemetry is only supported on Unix platforms".to_string())
}

#[cfg(unix)]
fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Unescapes octal escape sequences (such as `\040` for space) in `/proc/self/mountinfo`.
pub fn unescape_mount_path(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && i + 3 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3].is_ascii_digit()
        {
            if let Ok(oct_str) = std::str::from_utf8(&bytes[i + 1..i + 4]) {
                if let Ok(val) = u8::from_str_radix(oct_str, 8) {
                    out.push(val);
                    i += 4;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn is_ignored_block_device(source: &str) -> bool {
    let Some(dev) = source.strip_prefix("/dev/") else {
        return false;
    };
    dev.starts_with("loop")
        || dev.starts_with("zram")
        || dev.starts_with("ram")
        || dev.starts_with("mtdblock")
        || dev.starts_with("sr")
        || dev.starts_with("fd")
}

fn is_ignored_mount_point(mp: &str) -> bool {
    mp == "/dev"
        || mp.starts_with("/dev/")
        || mp == "/proc"
        || mp.starts_with("/proc/")
        || mp == "/sys"
        || mp.starts_with("/sys/")
        || mp == "/boot"
        || mp.starts_with("/boot/")
        || mp == "/snap"
        || mp.starts_with("/snap/")
        || (mp.starts_with("/run/") && !mp.starts_with("/run/media/"))
        || mp.starts_with("/var/lib/docker/overlay2/")
        || mp.starts_with("/var/lib/containers/storage/overlay/")
}

/// Parses `/proc/self/mountinfo` and selects the canonical mount point per backing storage source.
pub fn parse_mountinfo_candidates<F>(content: &str, is_dir_fn: F) -> Vec<MountCandidate>
where
    F: Fn(&str) -> bool,
{
    parse_mountinfo_candidates_scoped(content, DiskProbeScope::All, is_dir_fn)
}

pub fn parse_mountinfo_candidates_scoped<F>(
    content: &str,
    scope: DiskProbeScope,
    is_dir_fn: F,
) -> Vec<MountCandidate>
where
    F: Fn(&str) -> bool,
{
    let mut best_by_source: HashMap<String, MountCandidate> = HashMap::new();
    let mut source_order: Vec<String> = Vec::new();

    for line in content.lines() {
        let Some((left, right)) = line.split_once(" - ") else {
            continue;
        };
        let left_fields: Vec<&str> = left.split_whitespace().collect();
        let right_fields: Vec<&str> = right.split_whitespace().collect();
        if left_fields.len() < 6 || right_fields.len() < 2 {
            continue;
        }

        let mount_point = unescape_mount_path(left_fields[4]);
        let mount_opts = left_fields[5];
        let fs_type = right_fields[0].to_string();
        let source = unescape_mount_path(right_fields[1]);

        if IGNORED_FS_TYPES.contains(&fs_type.as_str()) {
            continue;
        }
        // Filter by scope BEFORE touching the filesystem (`is_dir_fn`) so a hung NFS mount never blocks local disk discovery
        if !scope_matches_fs(scope, is_network_fs_type(&fs_type)) {
            continue;
        }
        if is_ignored_mount_point(&mount_point) || is_ignored_block_device(&source) {
            continue;
        }

        let is_real_source =
            source.starts_with("/dev/") || NETWORK_OR_POOL_FS.contains(&fs_type.as_str());
        if !is_real_source {
            continue;
        }

        // Skip single-file bind mounts commonly injected into containers (e.g. /etc/hosts, /usr/share/zoneinfo/Etc/UTC)
        if !is_dir_fn(&mount_point) {
            continue;
        }

        let writable = !mount_opts.split(',').any(|opt| opt == "ro");
        let candidate = MountCandidate {
            mount_point,
            fs_type,
            source: source.clone(),
            writable,
        };

        if let Some(existing) = best_by_source.get_mut(&source) {
            if is_better_mount_point(&candidate, existing) {
                *existing = candidate;
            }
        } else {
            source_order.push(source.clone());
            best_by_source.insert(source, candidate);
        }
    }

    source_order
        .into_iter()
        .filter_map(|k| best_by_source.remove(&k))
        .collect()
}

fn is_better_mount_point(challenger: &MountCandidate, current: &MountCandidate) -> bool {
    if challenger.mount_point == "/" && current.mount_point != "/" {
        return true;
    }
    if current.mount_point == "/" {
        return false;
    }
    if challenger.writable != current.writable {
        return challenger.writable;
    }
    let chal_depth = challenger.mount_point.matches('/').count();
    let curr_depth = current.mount_point.matches('/').count();
    if chal_depth != curr_depth {
        return chal_depth < curr_depth;
    }
    challenger.mount_point.len() < current.mount_point.len()
}

/// Classifies the physical storage medium from `/sys/class/block/<dev>` topology, MMC `device/type`, and `queue/rotational`.
pub fn classify_block_media_from_sysfs(
    source: &str,
    fs_type: &str,
    sys_link_target: Option<&str>,
    mmc_type: Option<&str>,
    rotational: Option<&str>,
) -> String {
    if fs_type == "zfs" {
        return "ZFS".to_string();
    }
    if matches!(fs_type, "nfs" | "nfs4" | "cifs" | "smb3") {
        return "NAS".to_string();
    }

    let dev_name = source.strip_prefix("/dev/").unwrap_or(source);
    let link_lower = sys_link_target.unwrap_or("").to_ascii_lowercase();

    if link_lower.contains(".ufs") || link_lower.contains("/ufs/") {
        return "UFS".to_string();
    }
    if dev_name.starts_with("nvme") || link_lower.contains("/nvme/") {
        return "NVMe".to_string();
    }
    if dev_name.starts_with("mmcblk") || link_lower.contains("/mmc_host/") {
        if let Some(t) = mmc_type.map(str::trim) {
            if t.eq_ignore_ascii_case("SD") {
                return "SD".to_string();
            }
            if t.eq_ignore_ascii_case("MMC") {
                return "eMMC".to_string();
            }
        }
        return "SD/MMC".to_string();
    }
    if link_lower.contains("/usb") {
        return "USB".to_string();
    }
    if dev_name.starts_with("vd") || link_lower.contains("/virtio") {
        return "VirtIO".to_string();
    }
    if dev_name.starts_with("md") {
        return "RAID".to_string();
    }

    match rotational.map(str::trim) {
        Some("0") => "SSD".to_string(),
        Some("1") => "HDD".to_string(),
        _ => {
            if !dev_name.is_empty() {
                dev_name.to_uppercase()
            } else {
                "Disk".to_string()
            }
        }
    }
}

fn extract_parent_block_name(dev_name: &str, sys_link_target: Option<&str>) -> String {
    if let Some(link) = sys_link_target {
        let parts: Vec<&str> = link.split('/').collect();
        for (idx, seg) in parts.iter().enumerate() {
            if *seg == "block" {
                if let Some(parent) = parts.get(idx + 1) {
                    return (*parent).to_string();
                }
            }
        }
    }
    dev_name
        .trim_end_matches(|c: char| c.is_ascii_digit())
        .to_string()
}

/// Resolves device symlinks (`/dev/mapper/*`, `/dev/root`, `/dev/disk/by-uuid/*`) and walks Device Mapper `slaves`
/// up to the underlying physical block device (covering LVM / LUKS stacks).
fn resolve_physical_dev_name(source: &str) -> Option<String> {
    if !source.starts_with("/dev/") {
        return None;
    }
    let resolved = std::fs::canonicalize(source)
        .ok()
        .unwrap_or_else(|| Path::new(source).to_path_buf());
    let mut dev_name = resolved.file_name()?.to_string_lossy().into_owned();

    // Walk up to 4 `dm-*` slave layers (e.g. LVM -> LUKS -> NVMe partition)
    for _ in 0..4 {
        if !dev_name.starts_with("dm-") {
            break;
        }
        let slaves_dir = Path::new("/sys/block").join(&dev_name).join("slaves");
        let Ok(entries) = std::fs::read_dir(&slaves_dir) else {
            break;
        };
        let mut slaves: Vec<String> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        slaves.sort();
        let Some(first_slave) = slaves.into_iter().next() else {
            break;
        };
        dev_name = first_slave;
    }

    Some(dev_name)
}

fn detect_hardware_label(source: &str, fs_type: &str) -> String {
    let Some(dev_name) = resolve_physical_dev_name(source) else {
        return classify_block_media_from_sysfs(source, fs_type, None, None, None);
    };

    let sys_class_path = Path::new("/sys/class/block").join(&dev_name);
    let link_target = std::fs::read_link(&sys_class_path)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    let parent = extract_parent_block_name(&dev_name, link_target.as_deref());
    let parent_sys = Path::new("/sys/block").join(&parent);

    let mmc_type = std::fs::read_to_string(parent_sys.join("device/type")).ok();
    let rotational = std::fs::read_to_string(parent_sys.join("queue/rotational")).ok();

    let effective_source = format!("/dev/{dev_name}");
    classify_block_media_from_sysfs(
        &effective_source,
        fs_type,
        link_target.as_deref(),
        mmc_type.as_deref(),
        rotational.as_deref(),
    )
}

pub fn disambiguate_disk_labels(items: &mut [DiskTelemetryDto]) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for item in items.iter() {
        *counts.entry(item.label.clone()).or_insert(0) += 1;
    }

    let mut seen: HashMap<String, usize> = HashMap::new();
    for item in items.iter_mut() {
        if counts.get(&item.label).copied().unwrap_or(0) > 1 {
            let idx = seen.entry(item.label.clone()).or_insert(0);
            *idx += 1;
            item.label = format!("{} {}", item.label, *idx);
        }
    }
}

fn discover_and_sample_disks(scope: DiskProbeScope) -> Vec<DiskTelemetryDto> {
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
    let candidates = parse_mountinfo_candidates_scoped(&mountinfo, scope, |mp| {
        std::fs::metadata(mp).is_ok_and(|m| m.is_dir())
    });

    let mut results: Vec<DiskTelemetryDto> = Vec::new();
    let mut seen_fs: Vec<(u64, u64)> = Vec::new();

    for cand in candidates {
        let Ok(m) = statvfs_metrics(&cand.mount_point) else {
            continue;
        };
        if m.total_bytes == 0 {
            continue;
        }
        // Secondary deduplication by `(f_fsid, f_blocks)` avoids duplicate entries for btrfs subvolumes under distinct device aliases
        if m.fsid != 0 && seen_fs.contains(&(m.fsid, m.blocks)) {
            continue;
        }
        seen_fs.push((m.fsid, m.blocks));

        let label = detect_hardware_label(&cand.source, &cand.fs_type);
        results.push(DiskTelemetryDto {
            label,
            path: cand.mount_point,
            device: Some(cand.source),
            fs_type: Some(cand.fs_type),
            used_bytes: m.used_bytes,
            total_bytes: m.total_bytes,
            available_bytes: m.available_bytes,
            percent: m.percent,
            error: None,
        });
    }

    // Fallback for overlay-only containers or non-Linux Unix systems without `/proc/self/mountinfo`: include `/`
    let root_is_net = is_path_on_network_mount(&mountinfo, "/");
    if scope_matches_fs(scope, root_is_net) {
        if let Ok(root_m) = statvfs_metrics("/") {
            let root_covered = root_m.fsid != 0 && seen_fs.contains(&(root_m.fsid, root_m.blocks))
                || results.iter().any(|d| d.path == "/");
            if root_m.total_bytes > 0 && !root_covered {
                results.insert(
                    0,
                    DiskTelemetryDto {
                        label: "Root".to_string(),
                        path: "/".to_string(),
                        device: None,
                        fs_type: None,
                        used_bytes: root_m.used_bytes,
                        total_bytes: root_m.total_bytes,
                        available_bytes: root_m.available_bytes,
                        percent: root_m.percent,
                        error: None,
                    },
                );
            }
        }
    }

    if scope == DiskProbeScope::All {
        disambiguate_disk_labels(&mut results);
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn samples_configured_disks_and_isolates_missing_mount() {
        let items = vec![
            DiskConfig {
                path: "/".to_string(),
                label: "System".to_string(),
            },
            DiskConfig {
                path: "/nonexistent-pikbay-mount-xyz".to_string(),
                label: "Offline".to_string(),
            },
        ];
        let out = sample_disks_scoped(&items, DiskProbeScope::All);
        assert_eq!(out.len(), 2);
        assert!(out[0].error.is_none());
        assert!(out[0].total_bytes > 0);
        assert!(out[1].error.is_some());
    }

    #[test]
    fn isolates_symlinked_network_mounts_without_probing_inside_remote_fs() {
        let mountinfo = "\
31 1 259:2 / / rw,relatime - ext4 /dev/nvme0n1p2 rw
99 31 0:62 / /mnt/dead-nfs rw,relatime - nfs4 10.0.0.9:/tank rw
";
        let is_net = is_configured_path_on_network_mount_with(
            mountinfo,
            "/srv/nas-link/media/movies",
            |p| {
                let s = p.to_string_lossy();
                assert!(
                    !s.starts_with("/mnt/dead-nfs"),
                    "must never invoke syscalls inside the remote network mount: {s}"
                );
                if s == "/srv/nas-link" {
                    Some(PathBuf::from("../mnt/dead-nfs/export"))
                } else {
                    None
                }
            },
        );
        assert!(is_net);

        // Trailing `..` after a symlink (`symlink/..`) must expand the symlink first, matching kernel VFS
        let is_net_dotdot =
            is_configured_path_on_network_mount_with(mountinfo, "/srv/nas-link/..", |p| {
                let s = p.to_string_lossy();
                assert!(
                    !s.starts_with("/mnt/dead-nfs"),
                    "must never invoke syscalls inside the remote network mount: {s}"
                );
                if s == "/srv/nas-link" {
                    Some(PathBuf::from("../mnt/dead-nfs/export"))
                } else {
                    None
                }
            });
        assert!(is_net_dotdot);

        let is_local =
            is_configured_path_on_network_mount_with(mountinfo, "/srv/local-dir", |_| None);
        assert!(!is_local);
    }

    #[test]
    fn parses_mountinfo_deduplicates_bind_mounts_and_classifies_ufs_nvme_sd() {
        let sample_mountinfo = "\
1285 1424 0:27 /@/data /data rw,noatime - btrfs /dev/sda2 rw,ssd
1288 1424 0:27 /@/certs /etc/ssl/custom ro,noatime - btrfs /dev/sda2 rw,ssd
1292 1424 0:27 /@/UTC /usr/share/zoneinfo/Etc/UTC ro - btrfs /dev/sda2 rw
1295 1425 0:71 / /dev/shm rw - tmpfs shm rw
1301 1285 259:1 / /boot/efi rw,relatime - vfat /dev/nvme0n1p99 rw
1420 1285 0:51 /volumes/nvme /mnt/nvme rw,noatime - btrfs /dev/nvme0n1p1 rw
1422 1285 179:1 /volumes/sdcard /mnt/sdcard rw,noatime - ext4 /dev/mmcblk0p1 rw
";
        let cands =
            parse_mountinfo_candidates(sample_mountinfo, |mp| mp != "/usr/share/zoneinfo/Etc/UTC");
        assert_eq!(cands.len(), 3);
        assert_eq!(cands[0].source, "/dev/sda2");
        assert_eq!(cands[0].mount_point, "/data"); // writable and shallower than /etc/ssl/custom
        assert_eq!(cands[1].source, "/dev/nvme0n1p1");
        assert_eq!(cands[2].source, "/dev/mmcblk0p1");

        assert_eq!(
            classify_block_media_from_sysfs(
                "/dev/sda2",
                "btrfs",
                Some("../../devices/platform/soc/1d84000.ufs/host0/block/sda/sda2"),
                None,
                Some("0")
            ),
            "UFS"
        );
        assert_eq!(
            classify_block_media_from_sysfs(
                "/dev/nvme0n1p1",
                "btrfs",
                Some("../../devices/pci0000:00/0000:00:01.0/nvme/nvme0/nvme0n1/nvme0n1p1"),
                None,
                Some("0")
            ),
            "NVMe"
        );
        assert_eq!(
            classify_block_media_from_sysfs(
                "/dev/mmcblk0p1",
                "ext4",
                Some("../../devices/platform/soc/mmc0/mmc_host/mmc0/block/mmcblk0/mmcblk0p1"),
                Some("SD\n"),
                Some("0")
            ),
            "SD"
        );
        assert_eq!(
            classify_block_media_from_sysfs("/dev/sdb1", "ext4", None, None, Some("1\n")),
            "HDD"
        );
    }

    #[cfg(unix)]
    #[test]
    fn auto_discovers_at_least_one_real_disk_on_current_machine() {
        let auto = sample_disks_scoped(&[], DiskProbeScope::All);
        assert!(!auto.is_empty());
        assert!(auto.iter().all(|d| d.total_bytes > 0));
    }
}
