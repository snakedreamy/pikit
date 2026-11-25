import {
  registerLocaleGlob,
  translateWithLocale,
  type Locale,
  type MessageTree,
} from '../../../../lib/i18n/index.svelte';

registerLocaleGlob(
  'tool:cron',
  import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
);

export interface CronFieldSpec {
  raw: string;
  isWildcard: boolean;
  values: number[];
  set: ReadonlySet<number>;
}

export interface ParsedCron {
  hasSeconds: boolean;
  sec: CronFieldSpec;
  min: CronFieldSpec;
  hour: CronFieldSpec;
  dom: CronFieldSpec;
  mon: CronFieldSpec;
  dow: CronFieldSpec;
}

export type CronParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; error: string };

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DOW_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function formatLocalizedWeekday(dow: number, locale: Locale): string {
  // 2023-01-01 UTC is a Sunday (`dow = 0`); `Intl.DateTimeFormat` formats short weekday names for any locale
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2023, 0, 1 + (dow % 7))));
}

function parseAtom(
  token: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  mapSevenToZero = false
): number | null {
  const upper = token.toUpperCase();
  if (aliases && upper in aliases) {
    return aliases[upper];
  }
  if (!/^\d+$/.test(token)) return null;
  let num = Number(token);
  if (mapSevenToZero && num === 7) num = 0;
  const maxAllowed = mapSevenToZero ? 6 : max;
  if (num < min || num > maxAllowed) return null;
  return num;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  mapSevenToZero = false
): CronFieldSpec | null {
  const effectiveMax = mapSevenToZero ? 6 : max;
  if (raw === '*') {
    const values: number[] = [];
    for (let v = min; v <= effectiveMax; v++) values.push(v);
    return { raw, isWildcard: true, values, set: new Set(values) };
  }

  const outSet = new Set<number>();
  const parts = raw.split(',');

  for (const part of parts) {
    if (!part) return null;
    const slashSplit = part.split('/');
    if (slashSplit.length > 2) return null;

    const rangeToken = slashSplit[0];
    let step = 1;
    if (slashSplit.length === 2) {
      if (!/^\d+$/.test(slashSplit[1])) return null;
      step = Number(slashSplit[1]);
      if (step <= 0) return null;
    }

    let start = min;
    let end = effectiveMax;

    if (rangeToken === '*') {
      // keep [min..effectiveMax]
    } else if (rangeToken.includes('-')) {
      const dashSplit = rangeToken.split('-');
      if (dashSplit.length !== 2) return null;
      const a = parseAtom(dashSplit[0], min, max, aliases, false);
      const b = parseAtom(dashSplit[1], min, max, aliases, false);
      if (a === null || b === null || a > b) return null;
      for (let v = a; v <= b; v += step) {
        outSet.add(mapSevenToZero && v === 7 ? 0 : v);
      }
      continue;
    } else {
      const single = parseAtom(rangeToken, min, max, aliases, mapSevenToZero);
      if (single === null) return null;
      if (slashSplit.length === 2) {
        start = single;
        end = effectiveMax;
      } else {
        start = single;
        end = single;
      }
    }

    for (let v = start; v <= end; v += step) {
      outSet.add(v);
    }
  }

  if (outSet.size === 0) return null;
  const values = Array.from(outSet).sort((a, b) => a - b);
  return { raw, isWildcard: false, values, set: outSet };
}

export function parseCronExpression(expr: string): CronParseResult {
  const tokens = expr.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 5 && tokens.length !== 6) {
    return {
      ok: false,
      error: `Expected 5 or 6 space-separated fields, got ${tokens.length}`,
    };
  }

  const hasSeconds = tokens.length === 6;
  const secRaw = hasSeconds ? tokens[0] : '0';
  const offset = hasSeconds ? 1 : 0;

  const sec = parseField(secRaw, 0, 59);
  if (!sec) return { ok: false, error: `Invalid second field: "${secRaw}"` };

  const min = parseField(tokens[offset], 0, 59);
  if (!min) return { ok: false, error: `Invalid minute field: "${tokens[offset]}"` };

  const hour = parseField(tokens[offset + 1], 0, 23);
  if (!hour) return { ok: false, error: `Invalid hour field: "${tokens[offset + 1]}"` };

  const dom = parseField(tokens[offset + 2], 1, 31);
  if (!dom) return { ok: false, error: `Invalid day-of-month field: "${tokens[offset + 2]}"` };

  const mon = parseField(tokens[offset + 3], 1, 12, MONTH_ALIASES);
  if (!mon) return { ok: false, error: `Invalid month field: "${tokens[offset + 3]}"` };

  const dow = parseField(tokens[offset + 4], 0, 7, DOW_ALIASES, true);
  if (!dow) return { ok: false, error: `Invalid day-of-week field: "${tokens[offset + 4]}"` };

  return {
    ok: true,
    cron: { hasSeconds, sec, min, hour, dom, mon, dow },
  };
}

function matchesDay(cron: ParsedCron, d: Date): boolean {
  const domMatch = cron.dom.set.has(d.getDate());
  const dowMatch = cron.dow.set.has(d.getDay());
  // Standard Vixie Cron semantics: OR union when both `dom` and `dow` are restricted (non-`*`); AND intersection otherwise
  if (!cron.dom.isWildcard && !cron.dow.isWildcard) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

/**
 * Computes the next `count` firing instants in the user's local timezone (hierarchical calendar skipping across leap years and DST).
 */
export function computeNextCronRuns(
  cron: ParsedCron,
  count = 8,
  fromDate: Date = new Date()
): Date[] {
  const results: Date[] = [];
  let cursor = new Date(Math.floor(fromDate.getTime() / 1000) * 1000 + 1000);
  const maxTimestamp = fromDate.getTime() + 8 * 366 * 24 * 3600 * 1000;

  while (results.length < count && cursor.getTime() <= maxTimestamp) {
    if (!cron.mon.set.has(cursor.getMonth() + 1)) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 0, 0, 0, 0);
      continue;
    }

    if (!matchesDay(cron, cursor)) {
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1,
        0,
        0,
        0,
        0
      );
      continue;
    }

    if (!cron.hour.set.has(cursor.getHours())) {
      const deltaMs =
        (60 - cursor.getMinutes()) * 60_000 - cursor.getSeconds() * 1000;
      cursor = new Date(cursor.getTime() + Math.max(1000, deltaMs));
      continue;
    }

    if (!cron.min.set.has(cursor.getMinutes())) {
      const deltaMs = (60 - cursor.getSeconds()) * 1000;
      cursor = new Date(cursor.getTime() + Math.max(1000, deltaMs));
      continue;
    }

    if (!cron.sec.set.has(cursor.getSeconds())) {
      cursor = new Date(cursor.getTime() + 1000);
      continue;
    }

    results.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 1000);
  }

  return results;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateTimeWithOffset(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());

  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = pad2(Math.floor(abs / 60));
  const om = pad2(abs % 60);
  return `${y}-${m}-${day} ${hh}:${mm}:${ss} (UTC${sign}${oh}:${om})`;
}

export function describeCron(cron: ParsedCron, locale: Locale): string {
  const tr = (key: string, params?: Record<string, string | number>) =>
    translateWithLocale(locale, `desc.${key}`, params, 'tool:cron');

  const partSep = tr('partSep');
  const listSep = tr('listSep');
  const parts: string[] = [];

  if (!cron.mon.isWildcard) {
    parts.push(tr('inMonth', { months: cron.mon.values.join(', ') }));
  }

  const domDesc = !cron.dom.isWildcard
    ? tr('onDom', { days: cron.dom.values.join(', ') })
    : '';
  const dowDesc = !cron.dow.isWildcard
    ? tr('onDow', {
        weekdays: cron.dow.values
          .map((v) => formatLocalizedWeekday(v, locale))
          .join(listSep),
      })
    : '';

  if (domDesc && dowDesc) {
    parts.push(tr('domOrDow', { dom: domDesc, dow: dowDesc }));
  } else if (domDesc) {
    parts.push(domDesc);
  } else if (dowDesc) {
    parts.push(dowDesc);
  } else {
    parts.push(tr('everyDay'));
  }

  if (
    !cron.hasSeconds &&
    cron.hour.values.length === 1 &&
    cron.min.values.length === 1
  ) {
    parts.push(
      tr('atTime', {
        time: `${pad2(cron.hour.values[0])}:${pad2(cron.min.values[0])}`,
      })
    );
    return parts.join(partSep);
  }

  if (cron.hour.isWildcard) {
    parts.push(tr('everyHour'));
  } else {
    parts.push(tr('duringHour', { hour: cron.hour.raw }));
  }

  if (cron.min.isWildcard) {
    parts.push(tr('everyMinute'));
  } else if (cron.min.raw.startsWith('*/')) {
    parts.push(tr('everyStepMinutes', { step: cron.min.raw.slice(2) }));
  } else {
    parts.push(tr('atMinute', { minute: cron.min.raw }));
  }

  if (cron.hasSeconds) {
    if (cron.sec.isWildcard) {
      parts.push(tr('everySecond'));
    } else if (cron.sec.raw.startsWith('*/')) {
      parts.push(tr('everyStepSeconds', { step: cron.sec.raw.slice(2) }));
    } else {
      parts.push(tr('atSecond', { second: cron.sec.raw }));
    }
  }

  return parts.join(partSep);
}
