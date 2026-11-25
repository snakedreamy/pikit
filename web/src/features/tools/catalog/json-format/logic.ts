export type JsonIndent = '2' | '4' | 'tab' | 'minify';

export interface JsonFormatResult {
  ok: boolean;
  output: string;
  errorLine?: number;
  errorColumn?: number;
  errorMessage?: string;
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < safeOffset; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, column: col };
}

/**
 * Engine-agnostic RFC 8259 scanner locating the exact first syntax-error character offset when `JSON.parse` fails.
 */
export function findJsonErrorOffset(s: string): number {
  let i = 0;
  const n = s.length;

  const skipWs = () => {
    while (i < n) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++;
      else break;
    }
  };

  const scanString = (): number | null => {
    if (s[i] !== '"') return i;
    i++;
    while (i < n) {
      const ch = s.charCodeAt(i);
      if (ch < 0x20) return i;
      if (ch === 0x22) {
        i++;
        return null;
      }
      if (ch === 0x5c) {
        i++;
        if (i >= n) return i;
        const esc = s[i];
        if ('"\\/bfnrt'.includes(esc)) {
          i++;
        } else if (esc === 'u') {
          i++;
          for (let k = 0; k < 4; k++) {
            if (i >= n || !/[0-9a-fA-F]/.test(s[i])) return i;
            i++;
          }
        } else {
          return i;
        }
      } else {
        i++;
      }
    }
    return i;
  };

  const scanLiteral = (lit: string): number | null => {
    for (let k = 0; k < lit.length; k++) {
      if (i >= n || s[i] !== lit[k]) return i;
      i++;
    }
    return null;
  };

  const scanNumber = (): number | null => {
    if (s[i] === '-') {
      i++;
      if (i >= n) return i;
    }
    if (s[i] === '0') {
      i++;
      if (i < n && s[i] >= '0' && s[i] <= '9') return i;
    } else if (s[i] >= '1' && s[i] <= '9') {
      while (i < n && s[i] >= '0' && s[i] <= '9') i++;
    } else {
      return i;
    }
    if (i < n && s[i] === '.') {
      i++;
      if (i >= n || s[i] < '0' || s[i] > '9') return i;
      while (i < n && s[i] >= '0' && s[i] <= '9') i++;
    }
    if (i < n && (s[i] === 'e' || s[i] === 'E')) {
      i++;
      if (i < n && (s[i] === '+' || s[i] === '-')) i++;
      if (i >= n || s[i] < '0' || s[i] > '9') return i;
      while (i < n && s[i] >= '0' && s[i] <= '9') i++;
    }
    return null;
  };

  const scanValue = (depth: number): number | null => {
    if (depth > 512) return i;
    skipWs();
    if (i >= n) return i;
    const ch = s[i];
    if (ch === '"') return scanString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return scanNumber();
    if (ch === 't') return scanLiteral('true');
    if (ch === 'f') return scanLiteral('false');
    if (ch === 'n') return scanLiteral('null');
    if (ch === '[') {
      i++;
      skipWs();
      if (i < n && s[i] === ']') {
        i++;
        return null;
      }
      while (true) {
        const err = scanValue(depth + 1);
        if (err !== null) return err;
        skipWs();
        if (i < n && s[i] === ',') {
          i++;
          skipWs();
          if (i >= n || s[i] === ']') return i;
          continue;
        }
        if (i < n && s[i] === ']') {
          i++;
          return null;
        }
        return i;
      }
    }
    if (ch === '{') {
      i++;
      skipWs();
      if (i < n && s[i] === '}') {
        i++;
        return null;
      }
      while (true) {
        skipWs();
        if (i >= n || s[i] !== '"') return i;
        const keyErr = scanString();
        if (keyErr !== null) return keyErr;
        skipWs();
        if (i >= n || s[i] !== ':') return i;
        i++;
        const valErr = scanValue(depth + 1);
        if (valErr !== null) return valErr;
        skipWs();
        if (i < n && s[i] === ',') {
          i++;
          skipWs();
          if (i >= n || s[i] !== '"') return i;
          continue;
        }
        if (i < n && s[i] === '}') {
          i++;
          return null;
        }
        return i;
      }
    }
    return i;
  };

  const rootErr = scanValue(0);
  if (rootErr !== null) return rootErr;
  skipWs();
  return i;
}

/**
 * Reformats whitespace directly over raw lexical tokens after `JSON.parse` validates syntax,
 * preserving 64-bit Snowflake IDs / `u64` integers (e.g. `9007199254740993`) and exact decimal mantissas
 * without IEEE 754 `Number` 53-bit precision loss.
 */
function reformatValidJsonTokens(s: string, indentUnit: string | null): string {
  let i = 0;
  const n = s.length;

  const skipWs = () => {
    while (i < n) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i += 1;
      else break;
    }
  };

  const readStringRaw = (): string => {
    const start = i;
    i += 1;
    while (i < n) {
      const ch = s[i];
      if (ch === '\\') {
        i += 2;
      } else if (ch === '"') {
        i += 1;
        break;
      } else {
        i += 1;
      }
    }
    return s.slice(start, i);
  };

  const readScalarRaw = (): string => {
    const start = i;
    while (i < n) {
      const ch = s[i];
      if (
        ch === ' ' ||
        ch === '\t' ||
        ch === '\r' ||
        ch === '\n' ||
        ch === ',' ||
        ch === ']' ||
        ch === '}' ||
        ch === ':'
      ) {
        break;
      }
      i += 1;
    }
    return s.slice(start, i);
  };

  const emitValue = (depth: number): string => {
    skipWs();
    const ch = s[i];
    if (ch === '"') {
      return readStringRaw();
    }
    if (ch === '[') {
      i += 1;
      skipWs();
      if (s[i] === ']') {
        i += 1;
        return '[]';
      }
      const items: string[] = [];
      while (i < n) {
        items.push(emitValue(depth + 1));
        skipWs();
        if (s[i] === ',') {
          i += 1;
          continue;
        }
        if (s[i] === ']') {
          i += 1;
          break;
        }
      }
      if (indentUnit === null) {
        return `[${items.join(',')}]`;
      }
      const innerPad = `\n${indentUnit.repeat(depth + 1)}`;
      const outerPad = `\n${indentUnit.repeat(depth)}`;
      return `[${innerPad}${items.join(`,${innerPad}`)}${outerPad}]`;
    }
    if (ch === '{') {
      i += 1;
      skipWs();
      if (s[i] === '}') {
        i += 1;
        return '{}';
      }
      const pairs: string[] = [];
      while (i < n) {
        skipWs();
        const keyRaw = readStringRaw();
        skipWs();
        i += 1; // ':'
        const valRaw = emitValue(depth + 1);
        pairs.push(indentUnit === null ? `${keyRaw}:${valRaw}` : `${keyRaw}: ${valRaw}`);
        skipWs();
        if (s[i] === ',') {
          i += 1;
          continue;
        }
        if (s[i] === '}') {
          i += 1;
          break;
        }
      }
      if (indentUnit === null) {
        return `{${pairs.join(',')}}`;
      }
      const innerPad = `\n${indentUnit.repeat(depth + 1)}`;
      const outerPad = `\n${indentUnit.repeat(depth)}`;
      return `{${innerPad}${pairs.join(`,${innerPad}`)}${outerPad}}`;
    }
    return readScalarRaw();
  };

  return emitValue(0);
}

export function formatJsonText(input: string, indent: JsonIndent = '2'): JsonFormatResult {
  if (!input.trim()) {
    return { ok: true, output: '' };
  }

  try {
    JSON.parse(input);
    const indentUnit =
      indent === 'minify' ? null : indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
    return { ok: true, output: reformatValidJsonTokens(input, indentUnit) };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const offset = findJsonErrorOffset(input);
    const { line, column } = offsetToLineCol(input, offset);
    return {
      ok: false,
      output: '',
      errorLine: line,
      errorColumn: column,
      errorMessage: rawMsg,
    };
  }
}
