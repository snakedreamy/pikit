import { describe, expect, it } from 'vitest';
import { inspectJwtToken } from './logic';

describe('JWT offline inspector logic', () => {
  const sample =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJzdWIiOiJ1c2VyLTEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.' +
    'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('decodes header, payload, and evaluates expiration accurately', () => {
    const active = inspectJwtToken(`Bearer ${sample}`, 1700001000 * 1000);
    expect(active.ok).toBe(true);
    expect(active.claims.alg).toBe('HS256');
    expect(active.claims.sub).toBe('user-1');
    expect(active.claims.expired).toBe(false);

    const expired = inspectJwtToken(sample, 1700009000 * 1000);
    expect(expired.claims.expired).toBe(true);
  });

  it('rejects malformed tokens, non-object JSON primitives, and guards astronomical timestamps', () => {
    expect(inspectJwtToken('not.a.jwt.at.all').ok).toBe(false);
    expect(inspectJwtToken('bad.%%%').ok).toBe(false);
    // Base64URL("123") = "MTIz" -> non-object JSON primitives must be rejected as invalid JWT segments
    expect(inspectJwtToken('MTIz.MTIz.sig').ok).toBe(false);

    // Astronomical `exp` values beyond ECMAScript `Date` range must not produce invalid epoch timestamps
    const hugeExpPayload = Buffer.from(JSON.stringify({ sub: 'u', exp: 1e25 })).toString('base64url');
    const hdr = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const hugeRes = inspectJwtToken(`${hdr}.${hugeExpPayload}.sig`);
    expect(hugeRes.ok).toBe(true);
    expect(hugeRes.claims.expMs).toBeUndefined();
  });
});
