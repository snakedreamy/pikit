import { describe, expect, it } from 'vitest';
import { formatBigIntInBase, parseBigIntInBase } from './logic';

describe('base-convert BigInt logic', () => {
  it('converts huge 128-bit integers accurately across bases 2..36', () => {
    const hex = '0xffffffff_ffffffff_ffffffff_ffffffff';
    const n = parseBigIntInBase(hex, 16)!;
    expect(formatBigIntInBase(n, 10)).toBe('340282366920938463463374607431768211455');
    expect(formatBigIntInBase(n, 2).length).toBe(128);
    expect(parseBigIntInBase(formatBigIntInBase(n, 36), 36)).toBe(n);
  });

  it('handles negative values and rejects out-of-radix digits', () => {
    expect(formatBigIntInBase(parseBigIntInBase('-1010', 2)!, 10)).toBe('-10');
    expect(parseBigIntInBase('102', 2)).toBeNull();
    expect(parseBigIntInBase('xyz', 16)).toBeNull();
  });
});
