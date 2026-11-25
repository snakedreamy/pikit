// Pure statistical helpers for network speedtest:
// - Latency / jitter: median RTT (after dropping the cold-start sample) + mean consecutive absolute delta
// - Sustained throughput: post-warmup 1s bucketed 10% trimmed mean with cumulative `Δbytes * 8 / Δsec` fallback

export interface PingStats {
  medianMs: number;
  jitterMs: number;
}

export interface ByteCheckpoint {
  elapsedMs: number;
  totalBytes: number;
}

/**
 * Computes median latency and mean consecutive jitter (discards the first cold-start sample when `>= 2` samples exist).
 */
export function computePingAndJitter(allRttsMs: readonly number[]): PingStats {
  if (allRttsMs.length === 0) {
    return { medianMs: 0, jitterMs: 0 };
  }
  const samples = allRttsMs.length >= 2 ? allRttsMs.slice(1) : [...allRttsMs];
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  let diffSum = 0;
  for (let i = 1; i < samples.length; i += 1) {
    diffSum += Math.abs(samples[i] - samples[i - 1]);
  }
  const jitterMs = samples.length >= 2 ? diffSum / (samples.length - 1) : 0;

  return { medianMs, jitterMs };
}

/**
 * Computes the arithmetic mean after trimming the lowest 10% and highest 10% of samples.
 */
export function computeTrimmedMeanMbps(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  const slice =
    sorted.length - trim * 2 >= 1 ? sorted.slice(trim, sorted.length - trim) : sorted;
  let sum = 0;
  for (const v of slice) sum += v;
  return sum / slice.length;
}

/**
 * Computes sustained throughput (Mbps) from cumulative confirmed-byte checkpoints:
 * 1. Measures over the post-`warmupMs` window (falling back to the full run if no post-warmup delta exists).
 * 2. Aggregates into 1000ms sub-windows and takes a 10% trimmed mean to reject single-second spikes.
 * 3. Falls back to `Δbytes * 8 / Δsec` when sparse chunk completions on high-RTT links diverge from bucketed means.
 */
export function computeSustainedThroughputMbps(
  checkpoints: readonly ByteCheckpoint[],
  warmupMs: number
): number {
  if (checkpoints.length === 0) return 0;
  const last = checkpoints[checkpoints.length - 1];
  if (last.totalBytes <= 0 || last.elapsedMs <= 0) return 0;

  const origin: ByteCheckpoint = { elapsedMs: 0, totalBytes: 0 };
  const allPts = [origin, ...checkpoints];

  let baseIdx = 0;
  for (let i = 0; i < allPts.length; i += 1) {
    if (allPts[i].elapsedMs <= warmupMs) {
      baseIdx = i;
    } else {
      break;
    }
  }

  let base = allPts[baseIdx];
  if (last.elapsedMs - base.elapsedMs < 300 || last.totalBytes <= base.totalBytes) {
    base = origin;
  }

  const spanMs = Math.max(1, last.elapsedMs - base.elapsedMs);
  const spanBytes = Math.max(0, last.totalBytes - base.totalBytes);
  const overallMbps = (spanBytes * 8) / ((spanMs / 1000) * 1_000_000);
  if (spanBytes === 0) return 0;

  // Aggregate into 1000ms buckets so 200ms ticks on buffered links do not produce zero-filled trimmed means
  const bucketMbps: number[] = [];
  let winStart = base;
  for (let i = baseIdx + 1; i < allPts.length; i += 1) {
    const pt = allPts[i];
    const dt = pt.elapsedMs - winStart.elapsedMs;
    if (dt >= 1000) {
      const db = Math.max(0, pt.totalBytes - winStart.totalBytes);
      bucketMbps.push((db * 8) / ((dt / 1000) * 1_000_000));
      winStart = pt;
    }
  }

  if (bucketMbps.length >= 4) {
    const trimmed = computeTrimmedMeanMbps(bucketMbps);
    if (trimmed >= overallMbps * 0.6 && trimmed <= overallMbps * 1.5) {
      return trimmed;
    }
  }

  return overallMbps;
}

/**
 * Bidirectionally adapts per-request stream chunk size (targeting ~180..500ms per round trip):
 * - Fast LAN (< 120ms): 4x scale-up to saturate multi-Gbps links without hitting per-IP RPM limits;
 * - Medium link (< 380ms): 2x scale-up;
 * - Slow/congested WAN (> 1600ms): 0.5x scale-down so server acknowledgments arrive steadily.
 */
export function nextAdaptiveChunkBytes(
  currentBytes: number,
  elapsedMs: number,
  maxBytes: number,
  minBytes = 64 * 1024
): number {
  if (elapsedMs < 120 && currentBytes < maxBytes) {
    return Math.min(maxBytes, currentBytes * 4);
  }
  if (elapsedMs < 380 && currentBytes < maxBytes) {
    return Math.min(maxBytes, currentBytes * 2);
  }
  if (elapsedMs > 1600 && currentBytes > minBytes) {
    return Math.max(minBytes, Math.floor(currentBytes / 2));
  }
  return Math.min(maxBytes, Math.max(minBytes, currentBytes));
}
