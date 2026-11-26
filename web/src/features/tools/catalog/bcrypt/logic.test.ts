import { describe, expect, it } from 'vitest';
import { generateBcryptHashSync, verifyBcryptHashSync } from './logic';

describe('Bcrypt Eksblowfish hash generator, verifier & Caddy basic_auth formatter', () => {
  it('generates $2b$ hashes, verifies matching/mismatching passwords, and formats Caddy snippets', () => {
    const out = generateBcryptHashSync('homelab-edge-pass', 6, 'ops');
    expect(out.hash.startsWith('$2b$06$')).toBe(true);
    expect(out.htpasswdLine).toBe(`ops:${out.hash}`);
    expect(out.caddySnippet).toContain(`ops ${out.hash}`);
    expect(out.truncated72Bytes).toBe(false);

    const ok = verifyBcryptHashSync('homelab-edge-pass', out.hash);
    expect(ok.validFormat).toBe(true);
    expect(ok.matched).toBe(true);
    expect(ok.rounds).toBe(6);

    const bad = verifyBcryptHashSync('wrong-password', out.hash);
    expect(bad.validFormat).toBe(true);
    expect(bad.matched).toBe(false);
  });

  it('flags passwords exceeding 72 UTF-8 bytes and rejects malformed hash strings', () => {
    const longOut = generateBcryptHashSync('x'.repeat(80), 4, 'admin');
    expect(longOut.truncated72Bytes).toBe(true);

    const malformed = verifyBcryptHashSync('test', 'not-a-bcrypt-hash');
    expect(malformed.validFormat).toBe(false);
  });
});
