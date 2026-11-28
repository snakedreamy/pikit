// Three-way YAML <-> JSON <-> TOML converter, formatter, and line/column syntax validator
// Bundled inside the lazy `data-convert` chunk so `yaml` and `smol-toml` never bloat the main bundle.
// Preserves 64-bit integers (`BigInt`) losslessly across all three formats without IEEE 754 precision loss.

import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  stringify as stringifyYaml,
  YAMLError,
} from 'yaml';

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
const MAX_SCIENTIFIC_INT_DIGITS = 100;

/**
 * Defines an own enumerable data property without triggering `Object.prototype.__proto__` setters.
 */
function setOwnDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

interface CanonicalDecimal {
  negative: boolean;
  sigDigits: string;
  scale10: number;
}

function parseCanonicalDecimal(raw: string): CanonicalDecimal | null {
  const m = raw.trim().match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/);
  if (!m) return null;
  const [, signRaw, mantissa, expRaw] = m;
  const exp = expRaw !== undefined ? Number(expRaw) : 0;
  if (!Number.isSafeInteger(exp)) return null;

  const dotIdx = mantissa.indexOf('.');
  const intPart = dotIdx >= 0 ? mantissa.slice(0, dotIdx) : mantissa;
  const fracPart = dotIdx >= 0 ? mantissa.slice(dotIdx + 1) : '';
  const combined = (intPart + fracPart).replace(/^0+/, '');
  if (combined === '') {
    return { negative: false, sigDigits: '0', scale10: 0 };
  }
  const sigDigits = combined.replace(/0+$/, '');
  const trailingZeros = combined.length - sigDigits.length;
  return {
    negative: signRaw === '-',
    sigDigits,
    scale10: exp - fracPart.length + trailingZeros,
  };
}

/**
 * Parses a numeric literal without silent precision loss or silent Infinity coercion:
 * - Exact mathematical integers (including `9223372036854775807.0` and `9.007199254740993e15`)
 *   outside IEEE 754 safe integer bounds stay `bigint`.
 * - Non-integer decimals whose significant digits cannot round-trip losslessly through IEEE 754 `double`
 *   (e.g. `9007199254740993.5`) or overflow `double` (`1e400`) throw an explicit error instead of rounding silently.
 */
function parseJsonNumberLossless(raw: string): number | bigint {
  const dec = parseCanonicalDecimal(raw);
  if (dec) {
    if (dec.sigDigits === '0') {
      return 0;
    }
    if (
      dec.scale10 >= 0 &&
      dec.sigDigits.length + dec.scale10 <= MAX_SCIENTIFIC_INT_DIGITS
    ) {
      const expanded = `${dec.negative ? '-' : ''}${dec.sigDigits}${'0'.repeat(dec.scale10)}`;
      const big = BigInt(expanded);
      return big >= MIN_SAFE_BIG && big <= MAX_SAFE_BIG ? Number(big) : big;
    }
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`Numeric value ${raw} overflows IEEE 754 double precision`);
  }

  if (dec && dec.sigDigits !== '0') {
    const roundTrip = parseCanonicalDecimal(String(num));
    if (
      !roundTrip ||
      roundTrip.negative !== dec.negative ||
      roundTrip.sigDigits !== dec.sigDigits ||
      roundTrip.scale10 !== dec.scale10
    ) {
      throw new Error(
        `Numeric value ${raw} exceeds IEEE 754 double precision and cannot be converted without rounding`
      );
    }
  }
  return num;
}

/**
 * Normalizes `bigint` values that fit safely within IEEE 754 `Number` back to `number`,
 * keeping only integers outside `[-2^53 + 1, 2^53 - 1]` as `bigint`, and converts `Map`
 * instances into plain objects with safe own properties (rejecting distinct keys that collide
 * after stringification, such as numeric `1` and string `"1"`).
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
  if (val instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of val.entries()) {
      const strKey =
        k !== null && typeof k === 'object' ? JSON.stringify(k) : String(k);
      if (Object.prototype.hasOwnProperty.call(out, strKey)) {
        throw new Error(
          `Duplicate object key "${strKey}" after string conversion (distinct non-string keys cannot be converted losslessly)`
        );
      }
      setOwnDataProperty(out, strKey, normalizeSafeBigInts(v));
    }
    return out;
  }
  if (val && typeof val === 'object' && !(val instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      setOwnDataProperty(out, k, normalizeSafeBigInts(v));
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
        const keyOffset = i;
        const key = readString();
        skipWs();
        i += 1; // ':'
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          throw Object.assign(
            new Error(`Duplicate JSON object key "${key}" cannot be converted without losing values`),
            { location: offsetToLineColumn(source, keyOffset) }
          );
        }
        setOwnDataProperty(obj, key, readValue());
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
    return parseJsonNumberLossless(raw);
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
      if (!Number.isFinite(val)) {
        throw new Error(`JSON does not support non-finite numbers (${String(val)})`);
      }
      return String(val);
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

function parseYamlLossless(source: string, lineCounter: LineCounter): unknown {
  const doc = parseDocument(source, {
    lineCounter,
    intAsBigInt: true,
    uniqueKeys: true,
  });
  if (doc.errors.length > 0) {
    throw doc.errors[0];
  }

  const walkAst = (node: unknown) => {
    if (!node) return;
    if (isScalar(node)) {
      if (typeof node.value === 'number' && node.range) {
        const rawSlice = source.slice(node.range[0], node.range[1]).trim();
        const cleaned = rawSlice.replace(/_/g, '');
        if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cleaned) || /^[+-]?\d+[eE][+-]?\d+$/.test(cleaned)) {
          node.value = parseJsonNumberLossless(cleaned);
        } else if (!Number.isFinite(node.value)) {
          throw new Error(`Numeric value ${rawSlice} overflows IEEE 754 double precision`);
        }
      }
      return;
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isPair(pair)) {
          walkAst(pair.key);
          walkAst(pair.value);
        }
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) {
        walkAst(item);
      }
    }
  };

  walkAst(doc.contents);
  return normalizeSafeBigInts(doc.toJS({ mapAsMap: true }));
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
      value = normalizeSafeBigInts(parseToml(input, { integersAsBigInt: 'asNeeded' }));
    } else {
      value = parseYamlLossless(input, yamlLineCounter);
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
