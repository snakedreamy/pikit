use serde::Serialize;

use super::cgroup::CgroupContext;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTelemetryDto {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub source: &'static str,
}

pub fn sample_memory(cg: &CgroupContext) -> Option<MemoryTelemetryDto> {
    let host_meminfo = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| parse_proc_meminfo(&s));
    let host_total = host_meminfo.map(|(tot, _)| tot).unwrap_or(0);

    // Use cgroup working-set memory only inside containers with an explicit `memory.max` cap below physical RAM
    // (e.g. `docker run -m 512m`); bare-metal hosts, systemd services, and uncapped containers read `/proc/meminfo`.
    if cg.in_container {
        let cg_max = std::fs::read_to_string(cg.dir.join("memory.max"))
            .ok()
            .and_then(|s| parse_cgroup_memory_max(&s));

        if let Some(limit_bytes) = cg_max {
            if host_total == 0 || limit_bytes < host_total {
                if let Ok(cur_raw) = std::fs::read_to_string(cg.dir.join("memory.current")) {
                    if let Ok(current_bytes) = cur_raw.trim().parse::<u64>() {
                        let inactive_file = std::fs::read_to_string(cg.dir.join("memory.stat"))
                            .ok()
                            .and_then(|s| parse_inactive_file_bytes(&s))
                            .unwrap_or(0);
                        let used_bytes =
                            current_bytes.saturating_sub(inactive_file).min(limit_bytes);
                        let pct =
                            ((used_bytes as f64 / limit_bytes as f64) * 100.0).clamp(0.0, 100.0);
                        return Some(MemoryTelemetryDto {
                            used_bytes,
                            total_bytes: limit_bytes,
                            percent: round1(pct),
                            source: "cgroup",
                        });
                    }
                }
            }
        }
    }

    // Standard whole-host path: `/proc/meminfo` (`MemTotal - MemAvailable`)
    let (total_bytes, avail_bytes) = host_meminfo?;
    if total_bytes == 0 {
        return None;
    }
    let used_bytes = total_bytes.saturating_sub(avail_bytes);
    let pct = ((used_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0);
    Some(MemoryTelemetryDto {
        used_bytes,
        total_bytes,
        percent: round1(pct),
        source: "host",
    })
}

pub fn parse_inactive_file_bytes(raw: &str) -> Option<u64> {
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("inactive_file ") {
            if let Ok(v) = rest.trim().parse::<u64>() {
                return Some(v);
            }
        }
    }
    None
}

pub fn parse_cgroup_memory_max(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    if trimmed == "max" || trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<u64>().ok().filter(|v| *v > 0)
}

pub fn parse_proc_meminfo(raw: &str) -> Option<(u64, u64)> {
    let mut total_kb: Option<u64> = None;
    let mut avail_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total_kb = parse_kb_value(rest);
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            avail_kb = parse_kb_value(rest);
        } else if let Some(rest) = line.strip_prefix("MemFree:") {
            free_kb = parse_kb_value(rest);
        }
    }

    let tot = total_kb?.saturating_mul(1024);
    let avail = avail_kb.or(free_kb).unwrap_or(0).saturating_mul(1024);
    Some((tot, avail))
}

fn parse_kb_value(rest: &str) -> Option<u64> {
    rest.split_whitespace().next()?.parse::<u64>().ok()
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meminfo_and_cgroup_stat() {
        let meminfo =
            "MemTotal:       16384000 kB\nMemFree:         2000000 kB\nMemAvailable:    8192000 kB\n";
        let (tot, avail) = parse_proc_meminfo(meminfo).unwrap();
        assert_eq!(tot, 16_384_000 * 1024);
        assert_eq!(avail, 8_192_000 * 1024);

        assert_eq!(
            parse_inactive_file_bytes("anon 100\ninactive_file 4096\n"),
            Some(4096)
        );
        assert_eq!(parse_cgroup_memory_max("max\n"), None);
        assert_eq!(parse_cgroup_memory_max("4294967296\n"), Some(4_294_967_296));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn bare_metal_context_always_reads_host_meminfo() {
        use std::path::PathBuf;
        let cg = CgroupContext {
            dir: PathBuf::from("/sys/fs/cgroup"),
            in_container: false,
        };
        let dto = sample_memory(&cg).expect("host /proc/meminfo should be readable");
        assert_eq!(dto.source, "host");
        assert!(dto.total_bytes > 0);
    }
}
