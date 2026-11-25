// Arbitrary-precision `BigInt` radix converter across bases 2..36

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function parseBigIntInBase(raw: string, radix: number): bigint | null {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) return null;
  let cleaned = raw.trim().replace(/[\s_]+/g, '').toLowerCase();
  if (!cleaned) return null;

  let negative = false;
  if (cleaned.startsWith('-')) {
    negative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  if (radix === 16 && cleaned.startsWith('0x')) cleaned = cleaned.slice(2);
  if (radix === 8 && cleaned.startsWith('0o')) cleaned = cleaned.slice(2);
  if (radix === 2 && cleaned.startsWith('0b')) cleaned = cleaned.slice(2);

  if (!cleaned) return null;

  const bigRadix = BigInt(radix);
  let acc = 0n;
  for (const ch of cleaned) {
    const val = DIGITS.indexOf(ch);
    if (val < 0 || val >= radix) return null;
    acc = acc * bigRadix + BigInt(val);
  }

  return negative ? -acc : acc;
}

export function formatBigIntInBase(value: bigint, radix: number): string {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
    throw new RangeError('Radix must be between 2 and 36');
  }
  return value.toString(radix);
}
