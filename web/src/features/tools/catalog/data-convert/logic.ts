// Three-way YAML <-> JSON <-> TOML converter, formatter, and line/column syntax validator
// Bundled inside the lazy `data-convert` chunk so `yaml` and `smol-toml` never bloat the main bundle.

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
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  const lines = trimmed.split(/\r?\n/);
  for (const rawLine of lines) {
    const ln = rawLine.trim();
    if (!ln || ln.startsWith('#')) continue;
    if (/^\[\[?[a-zA-Z0-9_."'-]+\]\]?$/.test(ln) || /^[a-zA-Z0-9_."'-]+\s*=/.test(ln)) {
      return 'toml';
    }
    break;
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

function parseJsonWithLocation(source: string): unknown {
  try {
    return JSON.parse(source);
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
      value = parseJsonWithLocation(input);
    } else if (detectedSource === 'toml') {
      value = parseToml(input);
    } else {
      value = parseYaml(input, { lineCounter: yamlLineCounter });
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
        output: JSON.stringify(value, null, indent),
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
        error: 'TOML root must be a key-value table/object (top-level arrays or scalars are not valid TOML)',
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
