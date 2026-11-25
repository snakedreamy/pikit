import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSpeedtestHistory,
  getSpeedtestHistory,
  MAX_SPEEDTEST_HISTORY,
  recordSpeedtestRun,
} from './history.svelte';

describe('speedtest local history', () => {
  beforeEach(() => {
    clearSpeedtestHistory();
  });

  it('caps stored history at 50 entries and clears cleanly', () => {
    for (let i = 0; i < 55; i += 1) {
      recordSpeedtestRun({
        timestamp: 1700000000000 + i * 1000,
        downloadMbps: 900 + i,
        uploadMbps: 850 + i,
        pingMs: 1.5,
        jitterMs: 0.2,
      });
    }
    expect(getSpeedtestHistory().length).toBe(MAX_SPEEDTEST_HISTORY);
    expect(getSpeedtestHistory()[0].downloadMbps).toBe(954);

    clearSpeedtestHistory();
    expect(getSpeedtestHistory()).toEqual([]);
  });
});
