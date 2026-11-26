use std::time::Instant;

use serde::Serialize;

use super::cgroup::CgroupContext;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuTelemetryDto {
    pub percent: f64,
    pub used_cores_text: String,
    pub total_cores: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_core: Option<Vec<f64>>,
    pub source: &'static str,
}

#[derive(Debug, Clone)]
pub struct CpuSamplePoint {
    pub captured_at: Instant,
    /// Populated only inside a container with an explicit CPU quota smaller than host logical core count.
    pub capped_cgroup_usage_usec: Option<u64>,
    pub capped_quota_cores: Option<f64>,
    pub host_parallelism: usize,
    pub host_total: Option<ProcStatLine>,
    pub host_cores: Vec<ProcStatLine>,
}

#[derive(Debug, Clone, Copy)]
pub struct ProcStatLine {
    pub idle_all: u64,
    pub total: u64,
}

impl ProcStatLine {
    pub fn usage_percent_since(self, prev: Self) -> f64 {
        let total_delta = self.total.saturating_sub(prev.total);
        if total_delta == 0 {
            return 0.0;
        }
        let idle_delta = self.idle_all.saturating_sub(prev.idle_all);
        let busy_delta = total_delta.saturating_sub(idle_delta);
        ((busy_delta as f64 / total_delta as f64) * 100.0).clamp(0.0, 100.0)
    }
}

pub fn capture_cpu_point(cg: &CgroupContext, include_per_core: bool) -> CpuSamplePoint {
    let fallback_parallelism = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let (host_total, host_cores, proc_core_count) = match std::fs::read_to_string("/proc/stat") {
        Ok(raw) => {
            let total_proc_cores = count_proc_stat_cores(&raw);
            let (agg, cores) = parse_proc_stat(&raw, include_per_core);
            (agg, cores, total_proc_cores)
        }
        Err(_) => (None, Vec::new(), 0),
    };

    // Inside a cpuset-pinned container `available_parallelism()` returns only pinned cores,
    // so take `max(proc_core_count, fallback_parallelism)` as the true host core baseline.
    let host_parallelism = proc_core_count.max(fallback_parallelism).max(1);

    let (capped_quota_cores, capped_cgroup_usage_usec) = if cg.in_container {
        // Detect explicit `cpu.max` quota or cpuset-pinned containers (`available_parallelism < proc_core_count`)
        let explicit_quota = std::fs::read_to_string(cg.dir.join("cpu.max"))
            .ok()
            .and_then(|s| parse_explicit_cpu_quota(&s, host_parallelism))
            .or((fallback_parallelism < host_parallelism).then_some(fallback_parallelism as f64));
        if let Some(q) = explicit_quota {
            let usage = std::fs::read_to_string(cg.dir.join("cpu.stat"))
                .ok()
                .and_then(|s| parse_cgroup_usage_usec(&s));
            (Some(q), usage)
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    CpuSamplePoint {
        captured_at: Instant::now(),
        capped_cgroup_usage_usec,
        capped_quota_cores,
        host_parallelism,
        host_total,
        host_cores,
    }
}

pub fn compute_cpu_delta(
    prev: &CpuSamplePoint,
    curr: &CpuSamplePoint,
    include_per_core: bool,
) -> Option<CpuTelemetryDto> {
    let wall_usec = curr
        .captured_at
        .saturating_duration_since(prev.captured_at)
        .as_micros() as f64;
    if wall_usec <= 0.0 {
        return None;
    }

    // 1) In CPU-capped containers (e.g. `docker run --cpus=2`), report usage against the container quota
    //    and omit host per-core bars so a 2-core quota never displays 8 host core columns alongside it.
    if let (Some(u0), Some(u1), Some(quota_cores)) = (
        prev.capped_cgroup_usage_usec,
        curr.capped_cgroup_usage_usec,
        curr.capped_quota_cores,
    ) {
        let delta_usec = u1.saturating_sub(u0) as f64;
        let used_cores = (delta_usec / wall_usec).max(0.0);
        let pct = ((used_cores / quota_cores.max(0.01)) * 100.0).clamp(0.0, 100.0);
        let display_total_cores = quota_cores.ceil().max(1.0) as usize;
        return Some(CpuTelemetryDto {
            percent: round1(pct),
            used_cores_text: format!("{used_cores:.1}"),
            total_cores: display_total_cores,
            per_core: None,
            source: "cgroup",
        });
    }

    // 2) Standard host path (bare metal, systemd units, and uncapped containers): read `/proc/stat`.
    if let (Some(h0), Some(h1)) = (prev.host_total, curr.host_total) {
        let per_core = if include_per_core
            && !curr.host_cores.is_empty()
            && curr.host_cores.len() == prev.host_cores.len()
        {
            Some(
                curr.host_cores
                    .iter()
                    .zip(prev.host_cores.iter())
                    .map(|(c, p)| round1(c.usage_percent_since(*p)))
                    .collect::<Vec<_>>(),
            )
        } else {
            None
        };

        let pct = h1.usage_percent_since(h0);
        let total_cores = curr.host_cores.len().max(curr.host_parallelism).max(1);
        let used_cores = (pct / 100.0) * (total_cores as f64);
        return Some(CpuTelemetryDto {
            percent: round1(pct),
            used_cores_text: format!("{used_cores:.1}"),
            total_cores,
            per_core,
            source: "host",
        });
    }

    None
}

/// Returns `Some(quota_cores)` only when `cpu.max` defines an explicit cap strictly below host logical cores;
/// returns `None` for `max` or uncapped quotas so whole-host `/proc/stat` metrics are used.
pub fn parse_explicit_cpu_quota(raw: &str, host_parallelism: usize) -> Option<f64> {
    let mut parts = raw.split_whitespace();
    let quota_str = parts.next()?;
    let period_str = parts.next().unwrap_or("100000");
    if quota_str == "max" {
        return None;
    }
    let quota: f64 = quota_str.parse().ok()?;
    let period: f64 = period_str.parse().ok()?;
    if quota > 0.0 && period > 0.0 {
        let cores = (quota / period).max(0.05);
        if cores + 0.01 < (host_parallelism as f64) {
            return Some(cores);
        }
    }
    None
}

pub fn parse_cgroup_usage_usec(raw: &str) -> Option<u64> {
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("usage_usec ") {
            if let Ok(val) = rest.trim().parse::<u64>() {
                return Some(val);
            }
        }
    }
    None
}

pub fn parse_proc_stat(
    raw: &str,
    include_per_core: bool,
) -> (Option<ProcStatLine>, Vec<ProcStatLine>) {
    let mut agg = None;
    let mut cores = Vec::new();

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("cpu ") {
            agg = parse_stat_numbers(rest);
        } else if include_per_core && line.starts_with("cpu") {
            let mut parts = line.split_whitespace();
            let Some(tag) = parts.next() else {
                continue;
            };
            if tag.len() > 3 && tag[3..].chars().all(|c| c.is_ascii_digit()) {
                let nums_str = &line[tag.len()..];
                if let Some(parsed) = parse_stat_numbers(nums_str) {
                    cores.push(parsed);
                }
            }
        }
    }

    (agg, cores)
}

fn count_proc_stat_cores(raw: &str) -> usize {
    raw.lines()
        .filter(|line| {
            let Some(tag) = line.split_whitespace().next() else {
                return false;
            };
            tag.len() > 3 && tag.starts_with("cpu") && tag[3..].chars().all(|c| c.is_ascii_digit())
        })
        .count()
}

fn parse_stat_numbers(rest: &str) -> Option<ProcStatLine> {
    let cols: Vec<u64> = rest
        .split_whitespace()
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    if cols.len() < 4 {
        return None;
    }
    let idle = cols[3];
    let iowait = cols.get(4).copied().unwrap_or(0);
    // Linux `/proc/stat` `user` (0) and `nice` (1) already include `guest` (8) and `guest_nice` (9);
    // sum only the first 8 columns (`user..=steal`) so KVM hypervisor hosts do not double-count guest ticks.
    let total: u64 = cols.iter().take(8).sum();
    Some(ProcStatLine {
        idle_all: idle.saturating_add(iowait),
        total,
    })
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parses_explicit_cpu_quota_and_proc_stat_accurately() {
        // Uncapped or host-equal quotas fall back to whole-host `/proc/stat`
        assert_eq!(parse_explicit_cpu_quota("max 100000\n", 8), None);
        assert_eq!(parse_explicit_cpu_quota("800000 100000\n", 8), None);
        // Explicit 2-core cap on an 8-core host enables container quota accounting
        assert_eq!(parse_explicit_cpu_quota("200000 100000\n", 8), Some(2.0));
        assert_eq!(
            parse_cgroup_usage_usec("usage_usec 1234567\nuser_usec 100\n"),
            Some(1234567)
        );

        let sample_stat = "\
cpu  1000 0 500 8500 0 0 0 0 400 0
cpu0 600 0 200 4200 0 0 0 0 200 0
cpu1 400 0 300 4300 0 0 0 0 200 0
";
        let (agg, cores) = parse_proc_stat(sample_stat, true);
        let next_stat = "\
cpu  1200 0 600 9200 0 0 0 0 500 0
cpu0 800 0 200 4500 0 0 0 0 300 0
cpu1 400 0 400 4700 0 0 0 0 200 0
";
        let (agg2, cores2) = parse_proc_stat(next_stat, true);

        let t0 = Instant::now();
        let prev = CpuSamplePoint {
            captured_at: t0,
            capped_cgroup_usage_usec: None,
            capped_quota_cores: None,
            host_parallelism: 2,
            host_total: agg,
            host_cores: cores,
        };
        let curr = CpuSamplePoint {
            captured_at: t0 + Duration::from_secs(1),
            capped_cgroup_usage_usec: None,
            capped_quota_cores: None,
            host_parallelism: 2,
            host_total: agg2,
            host_cores: cores2,
        };

        let dto = compute_cpu_delta(&prev, &curr, true).unwrap();
        assert_eq!(dto.source, "host");
        assert_eq!(dto.percent, 30.0);
        assert_eq!(dto.total_cores, 2);
        assert_eq!(dto.per_core.unwrap(), vec![40.0, 20.0]);
    }
}
