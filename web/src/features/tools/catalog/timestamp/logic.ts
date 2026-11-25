// Bidirectional Unix epoch (s/ms), local timezone (with DST), UTC, and ISO 8601 converter

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

export function parseFlexibleTimestamp(raw: string): ParsedTimestamp | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let epochMs: number;
  let detectedUnit: 's' | 'ms' | 'date';

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return null;
    // Magnitudes `< 1e11` (covering Unix seconds up to year 5138) are treated as seconds; larger magnitudes as milliseconds
    if (Math.abs(num) < 1e11 && !trimmed.includes('.')) {
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
