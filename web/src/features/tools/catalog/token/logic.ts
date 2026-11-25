// Modulo-bias-free rejection-sampling random token / password generator with Shannon pool entropy calculation

export interface TokenOptions {
  length: number;
  count: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);

export function buildCharacterPool(opts: Omit<TokenOptions, 'length' | 'count'>): string {
  let raw = '';
  if (opts.uppercase) raw += UPPER;
  if (opts.lowercase) raw += LOWER;
  if (opts.digits) raw += DIGITS;
  if (opts.symbols) raw += SYMBOLS;
  if (opts.excludeAmbiguous) {
    raw = Array.from(raw)
      .filter((ch) => !AMBIGUOUS.has(ch))
      .join('');
  }
  return raw;
}

export function computeEntropyBits(length: number, poolSize: number): number {
  if (length <= 0 || poolSize <= 1) return 0;
  return Math.round(length * Math.log2(poolSize) * 10) / 10;
}

function secureRandomIndex(maxExclusive: number): number {
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return buf[0] % maxExclusive;
    }
  }
}

export function generateTokens(opts: TokenOptions): {
  poolSize: number;
  entropyBits: number;
  tokens: string[];
} {
  const pool = buildCharacterPool(opts);
  if (!pool) {
    return { poolSize: 0, entropyBits: 0, tokens: [] };
  }

  const len = Math.min(256, Math.max(4, Math.floor(opts.length)));
  const count = Math.min(50, Math.max(1, Math.floor(opts.count)));
  const tokens: string[] = [];

  for (let n = 0; n < count; n += 1) {
    let token = '';
    for (let i = 0; i < len; i += 1) {
      token += pool[secureRandomIndex(pool.length)];
    }
    tokens.push(token);
  }

  return {
    poolSize: pool.length,
    entropyBits: computeEntropyBits(len, pool.length),
    tokens,
  };
}
