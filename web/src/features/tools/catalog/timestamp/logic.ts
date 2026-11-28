// Bidirectional Unix epoch (s/ms), local timezone (with DST), UTC, and ISO 8601 converter

export type TimestampInputMode = 'auto' | 's' | 'ms';

export interface ParsedTimestamp {
  ok: boolean;
  epochMs: number;
  epochSec: number;
  detectedUnit?: 's' | 'ms' | 'date';
  isoUtc: string;
  utcString: string;
  localString: string;
  localTimeZone: string;
}

function formatInLocalTimeZone(d: Date): { formatted: string; timeZone: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const frac = String(d.getMilliseconds()).padStart(3, '0');
  const hh = get('hour') === '24' ? '00' : get('hour');
  const offset = get('timeZoneName') || tz;
  return {
    formatted: `${get('year')}-${get('month')}-${get('day')} ${hh}:${get('minute')}:${get('second')}.${frac} (${offset})`,
    timeZone: tz,
  };
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function daysInCalendarMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Rejects impossible calendar dates (such as `2026-02-30` or `2026-04-31`) that V8 `Date.parse`
 * would otherwise silently roll forward into the following month.
 */
function hasInvalidCalendarDate(s: string): boolean {
  const ymd = s.match(
    /^([+-]?\d{4,6})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInCalendarMonth(year, month)) {
      return true;
    }
    if (ymd[4] !== undefined) {
      const hh = Number(ymd[4]);
      const mm = Number(ymd[5]);
      const ss = ymd[6] !== undefined ? Number(ymd[6]) : 0;
      if (hh > 23 || mm > 59 || ss > 60) return true;
    }
    return false;
  }

  const dmy = s.match(/(?:^[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = MONTH_MAP[dmy[2].toLowerCase()] ?? 0;
    const year = Number(dmy[3]);
    if (!month || day < 1 || day > daysInCalendarMonth(year, month)) return true;
  }

  const mdy = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (mdy) {
    const month = MONTH_MAP[mdy[1].toLowerCase()] ?? 0;
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    if (!month || day < 1 || day > daysInCalendarMonth(year, month)) return true;
  }

  return false;
}

export function parseFlexibleTimestamp(
  raw: string,
  mode: TimestampInputMode = 'auto'
): ParsedTimestamp | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let epochMs: number;
  let detectedUnit: 's' | 'ms' | 'date';

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return null;
    if (mode === 's') {
      epochMs = trimmed.includes('.') ? Math.round(num * 1000) : num * 1000;
      detectedUnit = 's';
    } else if (mode === 'ms') {
      epochMs = Math.round(num);
      detectedUnit = 'ms';
    } else if (Math.abs(num) < 1e11 && !trimmed.includes('.')) {
      // Magnitudes `< 1e11` (covering Unix seconds up to year 5138) are treated as seconds; larger magnitudes as milliseconds
      epochMs = num * 1000;
      detectedUnit = 's';
    } else if (Math.abs(num) < 1e11) {
      epochMs = Math.round(num * 1000);
      detectedUnit = 's';
    } else {
      epochMs = Math.round(num);
      detectedUnit = 'ms';
    }
  } else {
    if (hasInvalidCalendarDate(trimmed)) return null;
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    epochMs = parsed;
    detectedUnit = 'date';
  }

  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;

  const local = formatInLocalTimeZone(d);
  return {
    ok: true,
    epochMs,
    epochSec: Math.floor(epochMs / 1000),
    detectedUnit,
    isoUtc: d.toISOString(),
    utcString: d.toUTCString(),
    localString: local.formatted,
    localTimeZone: local.timeZone,
  };
}
