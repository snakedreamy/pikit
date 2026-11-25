import { describe, expect, it } from 'vitest';
import { computeHmac } from './logic';

describe('HMAC Web Crypto logic (RFC 4231 test vector)', () => {
  it('matches RFC 4231 Test Case 2 ("Jefe" / "what do ya want for nothing?")', async () => {
    const res = await computeHmac(
      'what do ya want for nothing?',
      'Jefe',
      'SHA-256',
      'utf8',
      'hex'
    );
    expect(res.ok).toBe(true);
    expect(res.output).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    );
  });

  it('rejects empty keys or malformed hex keys', async () => {
    expect((await computeHmac('msg', '', 'SHA-256', 'utf8')).error).toBe('empty_key');
    expect((await computeHmac('msg', 'zz11', 'SHA-256', 'hex')).error).toBe('invalid_hex_key');
  });
});
