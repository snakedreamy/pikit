import { describe, expect, it } from 'vitest';
import { digestPure, hmacPure, type ShaAlgorithm } from './digest';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('pure-TS SHA & HMAC fallback (plain-HTTP LAN compatibility)', () => {
  it('matches WebCrypto digest byte-for-byte across SHA-1, SHA-256, SHA-384, and SHA-512', async () => {
    const samples = [
      '',
      'abc',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      'a'.repeat(300),
    ];
    const algs: ShaAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

    for (const s of samples) {
      const data = new TextEncoder().encode(s);
      for (const alg of algs) {
        const expected = new Uint8Array(await crypto.subtle.digest(alg, data));
        const actual = digestPure(alg, data);
        expect(toHex(actual)).toBe(toHex(expected));
      }
    }
  });

  it('matches WebCrypto HMAC byte-for-byte including >blockSize keys', async () => {
    const msg = new TextEncoder().encode('pikbay-lan-http-fallback');
    const keys = ['short-key', 'k'.repeat(200)];
    const algs: ShaAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

    for (const k of keys) {
      const keyBytes = new TextEncoder().encode(k);
      for (const alg of algs) {
        const ck = await crypto.subtle.importKey(
          'raw',
          keyBytes,
          { name: 'HMAC', hash: { name: alg } },
          false,
          ['sign']
        );
        const expected = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg));
        const actual = hmacPure(alg, keyBytes, msg);
        expect(toHex(actual)).toBe(toHex(expected));
      }
    }
  });
});
