export interface RegexMatchItem {
  index: number;
  length: number;
  match: string;
  captures: Array<string | null>;
  groups: Record<string, string> | null;
}

export interface RegexSegment {
  text: string;
  matched: boolean;
  matchOrder?: number;
}

export type RegexExecResult =
  | {
      ok: true;
      matches: RegexMatchItem[];
      elapsedMs: number;
      truncated: boolean;
    }
  | {
      ok: false;
      error: string;
    };

const ALLOWED_FLAGS = ['g', 'i', 'm', 's', 'u'] as const;

export function normalizeRegexFlags(rawFlags: string): string {
  const out: string[] = [];
  for (const ch of ALLOWED_FLAGS) {
    if (rawFlags.includes(ch)) out.push(ch);
  }
  return out.join('');
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function executeRegexMatches(
  pattern: string,
  rawFlags: string,
  text: string,
  maxMatches = 500
): RegexExecResult {
  if (pattern.length === 0) {
    return { ok: true, matches: [], elapsedMs: 0, truncated: false };
  }

  const flags = normalizeRegexFlags(rawFlags);
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const t0 = nowMs();
  const matches: RegexMatchItem[] = [];
  let truncated = false;

  if (flags.includes('g')) {
    while (true) {
      const m = re.exec(text);
      if (!m) break;
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      const groupEntries = m.groups
        ? Object.fromEntries(
            Object.entries(m.groups).filter(([, val]) => val !== undefined)
          )
        : null;
      matches.push({
        index: m.index,
        length: m[0].length,
        match: m[0],
        captures: m.slice(1).map((v) => (v === undefined ? null : v)),
        groups: groupEntries && Object.keys(groupEntries).length > 0 ? groupEntries : null,
      });

      // Advance past zero-length matches (stepping by Unicode code point only when `u` flag is active)
      if (m[0].length === 0) {
        if (re.lastIndex >= text.length) break;
        if (flags.includes('u')) {
          const code = text.codePointAt(re.lastIndex);
          re.lastIndex += code !== undefined && code > 0xffff ? 2 : 1;
        } else {
          re.lastIndex += 1;
        }
      }
    }
  } else {
    const m = re.exec(text);
    if (m) {
      const groupEntries = m.groups
        ? Object.fromEntries(
            Object.entries(m.groups).filter(([, val]) => val !== undefined)
          )
        : null;
      matches.push({
        index: m.index,
        length: m[0].length,
        match: m[0],
        captures: m.slice(1).map((v) => (v === undefined ? null : v)),
        groups: groupEntries && Object.keys(groupEntries).length > 0 ? groupEntries : null,
      });
    }
  }

  const elapsedMs = Math.max(0, Number((nowMs() - t0).toFixed(2)));
  return { ok: true, matches, elapsedMs, truncated };
}

/**
 * Splits input text into non-overlapping plain-text segments so Svelte can render highlights safely without `innerHTML`.
 */
export function segmentTextByMatches(
  text: string,
  matches: readonly RegexMatchItem[]
): RegexSegment[] {
  if (text.length === 0) return [];
  if (matches.length === 0) return [{ text, matched: false }];

  const segments: RegexSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if (item.index < cursor) continue;
    if (item.index > cursor) {
      segments.push({
        text: text.slice(cursor, item.index),
        matched: false,
      });
    }
    if (item.length > 0) {
      segments.push({
        text: text.slice(item.index, item.index + item.length),
        matched: true,
        matchOrder: i + 1,
      });
      cursor = item.index + item.length;
    } else {
      segments.push({
        text: '▏',
        matched: true,
        matchOrder: i + 1,
      });
      cursor = item.index;
    }
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      matched: false,
    });
  }

  return segments;
}
