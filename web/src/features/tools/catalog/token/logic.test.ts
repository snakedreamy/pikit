import { describe, expect, it } from 'vitest';
import { computeEntropyBits, generateTokens } from './logic';

describe('CSPRNG token generator & entropy', () => {
  it('generates unbiased tokens respecting ambiguous exclusions and computes entropy', () => {
    const res = generateTokens({
      length: 32,
      count: 4,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: false,
      excludeAmbiguous: true,
    });
    expect(res.tokens.length).toBe(4);
    for (const tk of res.tokens) {
      expect(tk.length).toBe(32);
      expect(/[0Oo1lI]/.test(tk)).toBe(false);
    }
    expect(res.entropyBits).toBeGreaterThan(180);
    expect(computeEntropyBits(16, 2)).toBe(16);
  });
});
