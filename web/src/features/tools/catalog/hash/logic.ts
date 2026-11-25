// Cryptographic & checksum digests: SHA-1/256/384/512 via Web Crypto (with pure-TS plain-HTTP fallback) + RFC 1321 MD5

import { digestUniversal } from '../../../../lib/digest';

export type DigestEncoding = 'hex' | 'base64';

export interface AllHashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha384: string;
  sha512: string;
}

export function bytesToOutput(bytes: Uint8Array, encoding: DigestEncoding = 'hex'): string {
  if (encoding === 'base64') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// RFC 1321 per-round shift schedule and sine constants
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
);

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function md5Bytes(message: Uint8Array): Uint8Array {
  const origLen = message.length;
  const bitLenLo = (origLen << 3) >>> 0;
  const bitLenHi = (origLen >>> 29) >>> 0;

  const padLen = (((56 - ((origLen + 1) % 64)) + 64) % 64) + 1;
  const totalLen = origLen + padLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(message);
  buf[origLen] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(totalLen - 8, bitLenLo, true);
  view.setUint32(totalLen - 4, bitLenHi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let j = 0; j < 16; j += 1) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i += 1) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl32(sum, MD5_SHIFTS[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

export function md5Utf8(text: string, encoding: DigestEncoding = 'hex'): string {
  return bytesToOutput(md5Bytes(new TextEncoder().encode(text)), encoding);
}

export async function computeAllHashes(
  text: string,
  encoding: DigestEncoding = 'hex'
): Promise<AllHashes> {
  const data = new TextEncoder().encode(text);
  const [s1, s256, s384, s512] = await Promise.all([
    digestUniversal('SHA-1', data),
    digestUniversal('SHA-256', data),
    digestUniversal('SHA-384', data),
    digestUniversal('SHA-512', data),
  ]);

  return {
    md5: bytesToOutput(md5Bytes(data), encoding),
    sha1: bytesToOutput(s1, encoding),
    sha256: bytesToOutput(s256, encoding),
    sha384: bytesToOutput(s384, encoding),
    sha512: bytesToOutput(s512, encoding),
  };
}
