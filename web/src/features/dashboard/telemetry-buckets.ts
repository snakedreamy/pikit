export interface CoreBucket {
  startIndex: number;
  endIndex: number;
  percent: number;
}

/** Switch storage selector from inline tabs to a compact `<select>` above this disk count (supports 4..24+ drive bays) */
export const MAX_INLINE_DISK_TABS = 3;

/** Maximum per-core spectrum bars: <=16 cores render 1:1; >16 cores (e.g. 32/64/128 threads) aggregate evenly into 16 buckets */
export const MAX_CORE_BUCKETS = 16;

export function aggregateCoreBuckets(
  perCore: readonly number[],
  maxBuckets = MAX_CORE_BUCKETS
): CoreBucket[] {
  const n = perCore.length;
  if (n === 0 || maxBuckets <= 0) return [];

  if (n <= maxBuckets) {
    return perCore.map((pct, idx) => ({
      startIndex: idx,
      endIndex: idx,
      percent: Math.round(pct * 10) / 10,
    }));
  }

  const buckets: CoreBucket[] = [];
  for (let b = 0; b < maxBuckets; b++) {
    const start = Math.floor((b * n) / maxBuckets);
    const endExclusive = Math.floor(((b + 1) * n) / maxBuckets);
    const end = Math.max(start, endExclusive - 1);

    let sum = 0;
    let count = 0;
    for (let i = start; i <= end; i++) {
      sum += perCore[i] ?? 0;
      count += 1;
    }

    buckets.push({
      startIndex: start,
      endIndex: end,
      percent: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    });
  }

  return buckets;
}
