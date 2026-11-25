import { describe, expect, it } from 'vitest';
import { parseColorString } from './logic';

describe('color space converter (HEX / RGB / HSL / OKLCH)', () => {
  it('converts HEX, RGB, HSL, and OKLCH consistently', () => {
    const c = parseColorString('#f6b032')!;
    expect(c.rgb).toBe('rgb(246, 176, 50)');
    expect(c.oklch.startsWith('oklch(')).toBe(true);

    // Parsing the formatted OKLCH string back into RGB should land within minor quantization rounding
    const back = parseColorString(c.oklch)!;
    expect(Math.abs(back.rgbRaw.r - 246)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.rgbRaw.g - 176)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.rgbRaw.b - 50)).toBeLessThanOrEqual(2);
  });

  it('rejects malformed color strings', () => {
    expect(parseColorString('not-a-color')).toBeNull();
    expect(parseColorString('rgb(999, 0, 0)')).toBeNull();
  });
});
