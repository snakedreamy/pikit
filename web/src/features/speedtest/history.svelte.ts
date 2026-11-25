// Browser-local speedtest history (`localStorage` only, capped at 50 entries, never uploaded to the server)
import { readStorage, writeStorage } from '../../lib/storage';

export const MAX_SPEEDTEST_HISTORY = 50;

export interface SpeedtestHistoryEntry {
  id: string;
  timestamp: number;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
}

function isHistoryEntry(val: unknown): val is SpeedtestHistoryEntry {
  if (!val || typeof val !== 'object') return false;
  const r = val as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.timestamp === 'number' &&
    Number.isFinite(r.timestamp) &&
    typeof r.downloadMbps === 'number' &&
    Number.isFinite(r.downloadMbps) &&
    typeof r.uploadMbps === 'number' &&
    Number.isFinite(r.uploadMbps) &&
    typeof r.pingMs === 'number' &&
    Number.isFinite(r.pingMs) &&
    typeof r.jitterMs === 'number' &&
    Number.isFinite(r.jitterMs)
  );
}

function isHistoryList(val: unknown): val is SpeedtestHistoryEntry[] {
  return (
    Array.isArray(val) &&
    val.length <= MAX_SPEEDTEST_HISTORY &&
    val.every(isHistoryEntry)
  );
}

let historyState = $state<SpeedtestHistoryEntry[]>(
  readStorage('speedtest-history', isHistoryList, [])
);

export function getSpeedtestHistory(): readonly SpeedtestHistoryEntry[] {
  return historyState;
}

export function recordSpeedtestRun(
  entry: Omit<SpeedtestHistoryEntry, 'id'>
): SpeedtestHistoryEntry {
  const created: SpeedtestHistoryEntry = {
    id: `${entry.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
  };
  historyState = [created, ...historyState].slice(0, MAX_SPEEDTEST_HISTORY);
  writeStorage('speedtest-history', historyState);
  return created;
}

export function clearSpeedtestHistory(): void {
  historyState = [];
  writeStorage('speedtest-history', []);
}
