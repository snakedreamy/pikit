use std::path::{Path, PathBuf};

const CGROUP_ROOT: &str = "/sys/fs/cgroup";

#[derive(Debug, Clone)]
pub struct CgroupContext {
    pub dir: PathBuf,
    /// Whether the current process runs inside a container.
    /// On bare-metal or VM hosts (e.g. `systemd` unit `0::/system.slice/pikbay.service` or user login scopes),
    /// the child cgroup tracks only `pikbay` itself rather than whole-machine hardware load.
    pub in_container: bool,
}

/// Resolves the process cgroup v2 directory from `/proc/self/cgroup` (supports both private and host cgroup namespaces).
pub fn resolve_cgroup_v2_dir_from_str(content: &str, root: &Path) -> PathBuf {
    for line in content.lines() {
        if let Some(rel) = line.trim().strip_prefix("0::") {
            let trimmed = rel.trim_start_matches('/');
            if trimmed.is_empty() {
                return root.to_path_buf();
            }
            // Keep only normal path components to prevent traversal
            let clean: PathBuf = Path::new(trimmed)
                .components()
                .filter(|c| matches!(c, std::path::Component::Normal(_)))
                .collect();
            return root.join(clean);
        }
    }
    root.to_path_buf()
}

/// Detects containerized execution from `/proc/self/cgroup` hierarchy markers and container runtime files.
pub fn is_cgroup_containerized(
    cgroup_text: &str,
    has_container_marker_file: bool,
    root_has_limit_knobs: bool,
) -> bool {
    if has_container_marker_file {
        return true;
    }

    for line in cgroup_text.lines() {
        if let Some(rel) = line.trim().strip_prefix("0::") {
            let lower = rel.trim().to_ascii_lowercase();
            // The Linux kernel does not expose `memory.max` / `cpu.max` on the true host root `/sys/fs/cgroup`;
            // their presence under `0::/` indicates a private container cgroup namespace.
            if (lower == "/" || lower.is_empty()) && root_has_limit_knobs {
                return true;
            }
            if lower.contains("docker")
                || lower.contains("containerd")
                || lower.contains("kubepods")
                || lower.contains("libpod")
                || lower.contains("podman")
                || lower.contains("/lxc")
            {
                return true;
            }
        }
    }

    false
}

pub fn detect_cgroup_context() -> CgroupContext {
    let root = Path::new(CGROUP_ROOT);
    let cgroup_text = std::fs::read_to_string("/proc/self/cgroup").unwrap_or_default();
    let dir = if cgroup_text.is_empty() {
        root.to_path_buf()
    } else {
        resolve_cgroup_v2_dir_from_str(&cgroup_text, root)
    };

    let has_marker = Path::new("/.dockerenv").exists()
        || Path::new("/run/.containerenv").exists()
        || Path::new("/run/systemd/container").exists();
    let root_has_limit_knobs = root.join("memory.max").exists() || root.join("cpu.max").exists();

    let in_container = is_cgroup_containerized(&cgroup_text, has_marker, root_has_limit_knobs);

    CgroupContext { dir, in_container }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_private_and_host_cgroup_paths() {
        let root = Path::new("/sys/fs/cgroup");
        assert_eq!(
            resolve_cgroup_v2_dir_from_str("0::/\n", root),
            PathBuf::from("/sys/fs/cgroup")
        );
        assert_eq!(
            resolve_cgroup_v2_dir_from_str("0::/system.slice/docker-abc.scope\n", root),
            PathBuf::from("/sys/fs/cgroup/system.slice/docker-abc.scope")
        );
    }

    #[test]
    fn distinguishes_bare_metal_systemd_from_containers() {
        // Bare-metal systemd units and user login scopes must not be misclassified as containers
        assert!(!is_cgroup_containerized(
            "0::/system.slice/pikbay.service\n",
            false,
            false
        ));
        assert!(!is_cgroup_containerized(
            "0::/user.slice/user-1000.slice/session-2.scope\n",
            false,
            false
        ));
        // Bare-metal PID 1 / root cgroup (no memory.max / cpu.max on root)
        assert!(!is_cgroup_containerized("0::/\n", false, false));

        // Private-namespace container (`0::/` with child cgroup limit knobs mounted at root)
        assert!(is_cgroup_containerized("0::/\n", false, true));
        // Host-namespace Docker / Kubernetes containers
        assert!(is_cgroup_containerized(
            "0::/system.slice/docker-12345.scope\n",
            false,
            false
        ));
        assert!(is_cgroup_containerized(
            "0::/kubepods.slice/kubepods-burstable.slice/cri-containerd-xyz.scope\n",
            false,
            false
        ));
    }
}
