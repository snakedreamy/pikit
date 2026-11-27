// Three-way YAML <-> JSON <-> TOML converter, formatter, and line/column syntax validator
// Bundled inside the lazy `data-convert` chunk so `yaml` and `smol-toml` never bloat the main bundle.
// Preserves 64-bit integers (`BigInt`) losslessly across all three formats without IEEE 754 precision loss.

import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import { LineCounter, parse as parseYaml, stringify as stringifyYaml, YAMLError } from 'yaml';

export type DataFormat = 'yaml' | 'json' | 'toml';
export type SourceFormatOption = 'auto' | DataFormat;

export interface SyntaxLocation {
  line: number;
  column: number;
}

export type ConvertDataResult =
  | {
      ok: true;
      detectedSource: DataFormat;
      output: string;
    }
  | {
      ok: false;
      detectedSource: DataFormat;
      error: string;
      location?: SyntaxLocation;
    };

export function detectDataFormat(raw: string): DataFormat {
  const trimmed = raw.trim();
  if (!trimmed) return 'yaml';
  if (trimmed.startsWith('{')) return 'json';

  const nonCommentLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (nonCommentLines.length === 0) return 'yaml';
  const first = nonCommentLines[0];

  // Distinguish TOML `[table]` / `[[array_of_tables]]` headers from JSON `[...]` arrays
  if (trimmed.startsWith('[')) {
    const isTomlHeader =
      /^\[\[?[A-Za-z_][A-Za-z0-9_."'-]*\]\]?(?:\s*#.*)?$/.test(first) &&
      !/^\[(true|false|null)\]$/i.test(first);
    const hasTomlAssignment = nonCommentLines
      .slice(1)
      .some((ln) => /^[A-Za-z0-9_."'-]+\s*=/.test(ln));
    if (isTomlHeader || hasTomlAssignment) {
      return 'toml';
    }
    return 'json';
  }

  if (/^\[\[?[a-zA-Z0-9_."'-]+\]\]?(?:\s*#.*)?$/.test(first) || /^[a-zA-Z0-9_."'-]+\s*=/.test(first)) {
    return 'toml';
  }
  return 'yaml';
}

function offsetToLineColumn(source: string, offset: number): SyntaxLocation {
  const clamped = Math.max(0, Math.min(source.length, offset));
  const prefix = source.slice(0, clamped);
  const parts = prefix.split('\n');
  return {
    line: parts.length,
    column: (parts[parts.length - 1]?.length ?? 0) + 1,
  };
}

const MIN_SAFE_BIG = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Normalizes `bigint` values that fit safely within IEEE 754 `Number` back to `number`,
 * keeping only integers outside `[-2^53 + 1, 2^53 - 1]` as `bigint`.
 */
function normalizeSafeBigInts(val: unknown): unknown {
  if (typeof val === 'bigint') {
    if (val >= MIN_SAFE_BIG && val <= MAX_SAFE_BIG) {
      return Number(val);
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(normalizeSafeBigInts);
  }
  if (val && typeof val === 'object' && !(val instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = normalizeSafeBigInts(v);
    }
    return out;
  }
  return val;
}

/**
 * Parses RFC 8259 JSON with exact error line/column reporting while preserving integers
 * beyond `Number.MAX_SAFE_INTEGER` as `bigint` so 64-bit IDs never suffer silent rounding.
 */
function parseJsonLosslessWithLocation(source: string): unknown {
  try {
    JSON.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lineColMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColMatch) {
      throw Object.assign(new Error(message), {
        location: { line: Number(lineColMatch[1]), column: Number(lineColMatch[2]) },
      });
    }
    const posMatch = message.match(/position\s+(\d+)/i);
    if (posMatch) {
      throw Object.assign(new Error(message), {
        location: offsetToLineColumn(source, Number(posMatch[1])),
      });
    }
    throw err;
  }

  let i = 0;
  const n = source.length;

  const skipWs = () => {
    while (i < n) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i += 1;
      else break;
    }
  };

  const readString = (): string => {
    const start = i;
    i += 1;
    while (i < n) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
      } else if (ch === '"') {
        i += 1;
        break;
      } else {
        i += 1;
      }
    }
    return JSON.parse(source.slice(start, i)) as string;
  };

  const readValue = (): unknown => {
    skipWs();
    const ch = source[i];
    if (ch === '"') return readString();
    if (ch === '[') {
      i += 1;
      skipWs();
      const arr: unknown[] = [];
      if (source[i] === ']') {
        i += 1;
        return arr;
      }
      while (i < n) {
        arr.push(readValue());
        skipWs();
        if (source[i] === ',') {
          i += 1;
          continue;
        }
        if (source[i] === ']') {
          i += 1;
          break;
        }
      }
      return arr;
    }
    if (ch === '{') {
      i += 1;
      skipWs();
      const obj: Record<string, unknown> = {};
      if (source[i] === '}') {
        i += 1;
        return obj;
      }
      while (i < n) {
        skipWs();
        const key = readString();
        skipWs();
        i += 1; // ':'
        obj[key] = readValue();
        skipWs();
        if (source[i] === ',') {
          i += 1;
          continue;
        }
        if (source[i] === '}') {
          i += 1;
          break;
        }
      }
      return obj;
    }

    const start = i;
    while (i < n) {
      const c = source[i];
      if (
        c === ' ' ||
        c === '\t' ||
        c === '\r' ||
        c === '\n' ||
        c === ',' ||
        c === ']' ||
        c === '}' ||
        c === ':'
      ) {
        break;
      }
      i += 1;
    }
    const raw = source.slice(start, i);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^-?\d+$/.test(raw)) {
      const big = BigInt(raw);
      return big >= MIN_SAFE_BIG && big <= MAX_SAFE_BIG ? Number(raw) : big;
    }
    return Number(raw);
  };

  return readValue();
}

function stringifyJsonLossless(value: unknown, indent: number): string {
  const unit = indent > 0 ? ' '.repeat(indent) : '';

  const emit = (val: unknown, depth: number): string => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'number') {
      return Number.isFinite(val) ? String(val) : 'null';
    }
    if (typeof val === 'string') return JSON.stringify(val);
    if (val instanceof Date) return JSON.stringify(val.toISOString());

    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const items = val.map((item) => emit(item, depth + 1));
      if (!unit) return `[${items.join(',')}]`;
      const inner = `\n${unit.repeat(depth + 1)}`;
      const outer = `\n${unit.repeat(depth)}`;
      return `[${inner}${items.join(`,${inner}`)}${outer}]`;
    }

    if (typeof val === 'object') {
      const entries = Object.entries(val as Record<string, unknown>).filter(
        ([, v]) => v !== undefined
      );
      if (entries.length === 0) return '{}';
      const pairs = entries.map(([k, v]) => {
        const keyJson = JSON.stringify(k);
        const valJson = emit(v, depth + 1);
        return unit ? `${keyJson}: ${valJson}` : `${keyJson}:${valJson}`;
      });
      if (!unit) return `{${pairs.join(',')}}`;
      const inner = `\n${unit.repeat(depth + 1)}`;
      const outer = `\n${unit.repeat(depth)}`;
      return `{${inner}${pairs.join(`,${inner}`)}${outer}}`;
    }

    return JSON.stringify(String(val));
  };

  return emit(value, 0);
}

function findNullPath(val: unknown, currentPath = '$'): string | null {
  if (val === null) return currentPath;
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i += 1) {
      const hit = findNullPath(val[i], `${currentPath}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (val && typeof val === 'object' && !(val instanceof Date)) {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const hit = findNullPath(v, `${currentPath}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function convertStructuredData(
  input: string,
  sourceOption: SourceFormatOption,
  targetFormat: DataFormat,
  indent = 2
): ConvertDataResult {
  const detectedSource: DataFormat =
    sourceOption === 'auto' ? detectDataFormat(input) : sourceOption;

  if (!input.trim()) {
    return { ok: true, detectedSource, output: '' };
  }

  let value: unknown;
  const yamlLineCounter = new LineCounter();
  try {
    if (detectedSource === 'json') {
      value = parseJsonLosslessWithLocation(input);
    } else if (detectedSource === 'toml') {
      value = parseToml(input, { integersAsBigInt: 'asNeeded' });
    } else {
      value = normalizeSafeBigInts(
        parseYaml(input, { lineCounter: yamlLineCounter, intAsBigInt: true })
      );
    }
  } catch (err) {
    if (err instanceof TomlError) {
      return {
        ok: false,
        detectedSource,
        error: err.message.split('\n')[0] || err.message,
        location: { line: err.line, column: err.column },
      };
    }
    if (err instanceof YAMLError) {
      const pos =
        err.linePos?.[0] ??
        (Array.isArray(err.pos) ? yamlLineCounter.linePos(err.pos[0]) : undefined);
      return {
        ok: false,
        detectedSource,
        error: err.message.split('\n')[0] || err.message,
        location: pos ? { line: pos.line, column: pos.col } : undefined,
      };
    }
    const loc = (err as { location?: SyntaxLocation })?.location;
    return {
      ok: false,
      detectedSource,
      error: err instanceof Error ? err.message : String(err),
      location: loc,
    };
  }

  try {
    if (targetFormat === 'json') {
      return {
        ok: true,
        detectedSource,
        output: stringifyJsonLossless(value, indent),
      };
    }
    if (targetFormat === 'yaml') {
      return {
        ok: true,
        detectedSource,
        output: stringifyYaml(value, { indent }).trimEnd(),
      };
    }

    // Target is TOML 1.0: root must be a plain key-value table without `null` values
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        detectedSource,
        error:
          'TOML root must be a key-value table/object (top-level arrays or scalars are not valid TOML)',
      };
    }
    const nullPath = findNullPath(value);
    if (nullPath) {
      return {
        ok: false,
        detectedSource,
        error: `TOML 1.0 does not represent null values (found null at ${nullPath})`,
      };
    }

    return {
      ok: true,
      detectedSource,
      output: stringifyToml(value as Record<string, unknown>).trimEnd(),
    };
  } catch (err) {
    return {
      ok: false,
      detectedSource,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
