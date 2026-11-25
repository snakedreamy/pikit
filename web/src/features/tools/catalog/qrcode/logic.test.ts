import { describe, expect, it } from 'vitest';
import { buildQrCode } from './logic';

describe('qrcode logic', () => {
  it('encodes ASCII and UTF-8 Chinese strings into valid QR matrices and SVG documents', () => {
    const res = buildQrCode('https://pikbay.example.ts.net/你好', 'Q', 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.version).toBeGreaterThanOrEqual(2);
    expect(res.data.size).toBe(17 + res.data.version * 4 + 4); // QR module count + 2-module quiet zone on each side
    expect(res.data.utf8Bytes).toBe(36);
    expect(res.data.svgPath).toContain('M2 2h1v1h-1z'); // Top-left finder pattern origin module
    expect(res.data.svgDocument).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('handles empty input and oversized payload gracefully', () => {
    const empty = buildQrCode('');
    expect(empty).toEqual({ ok: false, empty: true });

    const huge = buildQrCode('A'.repeat(4000), 'H');
    expect(huge.ok).toBe(false);
    if (!huge.ok) {
      expect(huge.empty).toBe(false);
    }
  });
});
