import { describe, expect, it } from 'vitest';
import { computeAllHashes, md5Utf8 } from './logic';

describe('hash digests & RFC 1321 MD5 test vectors', () => {
  it('matches official RFC 1321 MD5 vectors', () => {
    expect(md5Utf8('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Utf8('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Utf8('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Utf8('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Utf8('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('computes SHA-1/256/384/512 via Web Crypto', async () => {
    const res = await computeAllHashes('abc', 'hex');
    expect(res.sha1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(res.sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(res.sha512.length).toBe(128);
  });
});
