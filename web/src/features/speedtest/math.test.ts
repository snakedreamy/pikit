import { describe, expect, it } from 'vitest';
import {
  computePingAndJitter,
  computeSustainedThroughputMbps,
  computeTailUploadChunkBytes,
  computeTrimmedMeanMbps,
  nextAdaptiveChunkBytes,
  type ByteCheckpoint,
} from './math';

describe('speedtest math', () => {
  it('discards first cold-start ping and computes median RTT + mean consecutive jitter', () => {
    // Discard cold-start 42ms -> remaining [10, 12, 11, 15, 12] -> sorted [10, 11, 12, 12, 15] -> median 12
    // Consecutive deltas: |12-10|=2, |11-12|=1, |15-11|=4, |12-15|=3 -> mean 10/4 = 2.5
    const stats = computePingAndJitter([42, 10, 12, 11, 15, 12]);
    expect(stats.medianMs).toBe(12);
    expect(stats.jitterMs).toBeCloseTo(2.5, 5);
  });

  it('computes 10% trimmed mean accurately on smooth streams', () => {
    const samples = [10, 100, 102, 98, 101, 99, 100, 100, 100, 500];
    expect(computeTrimmedMeanMbps(samples)).toBeCloseTo(100, 5);
  });

  it('never zeroes out bursty port-forwarded upload completions', () => {
    // Simulate a port-forwarded link confirming a 5 MB (40 Mbit) batch every 2s across 200ms checkpoints -> 20 Mbps sustained
    const pts: ByteCheckpoint[] = [];
    let bytes = 0;
    for (let t = 200; t <= 10_000; t += 200) {
      if (t % 2000 === 0) {
        bytes += 5 * 1_000_000;
      }
      pts.push({ elapsedMs: t, totalBytes: bytes });
    }
    const mbps = computeSustainedThroughputMbps(pts, 2000);
    expect(mbps).toBeGreaterThan(18);
    expect(mbps).toBeLessThan(22);
  });

  it('scales chunk sizes up on fast LAN and down on slow WAN links', () => {
    const mib = 1024 * 1024;
    expect(nextAdaptiveChunkBytes(128 * 1024, 50, 64 * mib)).toBe(512 * 1024);
    expect(nextAdaptiveChunkBytes(mib, 250, 64 * mib)).toBe(2 * mib);
    expect(nextAdaptiveChunkBytes(4 * mib, 2400, 64 * mib)).toBe(2 * mib);
  });

  it('tapers upload tail chunks near phase deadline to avoid cancelling in-flight HTTP/3 bodies', () => {
    const mib = 1024 * 1024;
    // Plenty of time left -> full chunk
    expect(computeTailUploadChunkBytes(2 * mib, 400, 3000, true)).toBe(2 * mib);
    // 250ms left with 500ms previous chunk -> ~42.5% of 2 MiB aligned to 16 KiB (< 1 MiB)
    const tapered = computeTailUploadChunkBytes(2 * mib, 500, 250, true);
    expect(tapered).toBeGreaterThanOrEqual(64 * 1024);
    expect(tapered).toBeLessThan(mib);
    expect(tapered % (16 * 1024)).toBe(0);
    // <= 120ms left after bytes already confirmed -> skip starting another request
    expect(computeTailUploadChunkBytes(mib, 300, 90, true)).toBe(0);
    // Slow link with zero confirmed bytes yet still gets minChunk before deadline
    expect(computeTailUploadChunkBytes(128 * 1024, 0, 90, false)).toBe(128 * 1024);
  });
});
