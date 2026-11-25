import { describe, expect, it } from 'vitest';
import { aggregateCoreBuckets, MAX_CORE_BUCKETS } from './telemetry-buckets';

describe('aggregateCoreBuckets scalable CPU core equalizer', () => {
  it('preserves 1:1 per-core bars when logical core count <= 16', () => {
    const eight = [10, 20, 30, 40, 50, 60, 70, 80];
    const out = aggregateCoreBuckets(eight);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ startIndex: 0, endIndex: 0, percent: 10 });
    expect(out[7]).toEqual({ startIndex: 7, endIndex: 7, percent: 80 });
  });

  it('evenly buckets high-core-count servers (e.g. 64 or 128 threads) into 16 readable bars', () => {
    const sixtyFour = Array.from({ length: 64 }, (_, idx) => (idx < 4 ? 50 : 10));
    const out = aggregateCoreBuckets(sixtyFour);
    expect(out).toHaveLength(MAX_CORE_BUCKETS);
    expect(out[0]).toEqual({ startIndex: 0, endIndex: 3, percent: 50 });
    expect(out[1]).toEqual({ startIndex: 4, endIndex: 7, percent: 10 });
    expect(out[15]).toEqual({ startIndex: 60, endIndex: 63, percent: 10 });
  });
});
