import { describe, expect, it } from 'vitest';
import { computeHotpCode, computeTotpWindow, decodeBase32Secret, parseOtpInput } from './logic';

describe('RFC 6238 TOTP & otpauth:// parser', () => {
  it('matches official RFC 6238 Appendix B test vectors for SHA-1, SHA-256, and SHA-512', () => {
    const enc = new TextEncoder();
    const secretSha1 = enc.encode('12345678901234567890');
    const secretSha256 = enc.encode('12345678901234567890123456789012');
    const secretSha512 = enc.encode(
      '1234567890123456789012345678901234567890123456789012345678901234'
    );

    // T = 59s -> step 1
    expect(computeHotpCode(secretSha1, 1n, 'SHA-1', 8)).toBe('94287082');
    expect(computeHotpCode(secretSha256, 1n, 'SHA-256', 8)).toBe('46119246');
    expect(computeHotpCode(secretSha512, 1n, 'SHA-512', 8)).toBe('90693936');

    // T = 1234567890s -> step 41152263
    const step = BigInt(Math.floor(1234567890 / 30));
    expect(computeHotpCode(secretSha1, step, 'SHA-1', 8)).toBe('89005924');
    expect(computeHotpCode(secretSha256, step, 'SHA-256', 8)).toBe('91819424');
    expect(computeHotpCode(secretSha512, step, 'SHA-512', 8)).toBe('93441116');
  });

  it('decodes RFC 4648 Base32 and parses otpauth://totp URIs accurately', () => {
    expect(Array.from(decodeBase32Secret('JBSW Y3DP-EHPK 3PXP'))).toEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef,
    ]);

    const uri =
      'otpauth://totp/Vault:admin%40example.ts.net?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Vault&algorithm=SHA1&digits=6&period=30';
    const parsed = parseOtpInput(uri);
    expect(parsed.issuer).toBe('Vault');
    expect(parsed.account).toBe('admin@example.ts.net');
    expect(parsed.digits).toBe(6);

    const win = computeTotpWindow({
      rawInput: uri,
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      nowMs: 59_000,
    });
    expect(win.ok).toBe(true);
    if (win.ok) {
      expect(win.current).toBe('287082');
      expect(win.remainingSeconds).toBe(1);
    }
  });
});
