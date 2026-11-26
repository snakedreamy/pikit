// Cross-context cryptographic primitives for `/drop` E2EE and offline `text-encrypt`:
// - Ephemeral X25519 (RFC 7748) with low-order point rejection
// - HKDF-SHA256 (RFC 5869)
// - ChaCha20-Poly1305 256-bit AEAD (RFC 8439)
// - PBKDF2-HMAC-SHA256 (RFC 8018) & AES-256-GCM (NIST SP 800-38D): native `crypto.subtle` in secure
//   contexts with bit-compatible pure TypeScript fallbacks for plain-HTTP private LAN origins.

import { hmacPure, sha256Pure } from './digest';

function hasSubtleCrypto(): boolean {
  return typeof globalThis.crypto !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function wipeBytes(buf: Uint8Array | null | undefined): void {
  if (buf) buf.fill(0);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64URL_ALPHABET[(n >>> 18) & 63] +
      B64URL_ALPHABET[(n >>> 12) & 63] +
      B64URL_ALPHABET[(n >>> 6) & 63] +
      B64URL_ALPHABET[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64URL_ALPHABET[(n >>> 18) & 63] + B64URL_ALPHABET[(n >>> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64URL_ALPHABET[(n >>> 18) & 63] +
      B64URL_ALPHABET[(n >>> 12) & 63] +
      B64URL_ALPHABET[(n >>> 6) & 63];
  }
  return out;
}

export function base64UrlToBytes(input: string): Uint8Array {
  const cleaned = input.trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (cleaned.length % 4 === 1) {
    throw new Error('Invalid Base64URL length');
  }
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i += 1) {
    lookup[B64URL_ALPHABET.charCodeAt(i)] = i;
  }

  const outLen = Math.floor((cleaned.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < cleaned.length; i += 1) {
    const code = cleaned.charCodeAt(i);
    const val = code < 128 ? lookup[code] : -1;
    if (val < 0) throw new Error('Invalid Base64URL character');
    acc = (acc << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx] = (acc >>> bits) & 0xff;
      outIdx += 1;
    }
  }
  return out;
}

// ============================================================================
// 1. RFC 7748 X25519 Key Agreement
// ============================================================================

const P25519 = (1n << 255n) - 19n;
const A24 = 121665n;

function modP(n: bigint): bigint {
  const r = n % P25519;
  return r < 0n ? r + P25519 : r;
}

function modPowP(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modP(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = modP(result * b);
    b = modP(b * b);
    e >>= 1n;
  }
  return result;
}

function clampX25519Scalar(scalarBytes: Uint8Array): bigint {
  if (scalarBytes.length !== 32) {
    throw new Error('X25519 private key must be 32 bytes');
  }
  const s = new Uint8Array(scalarBytes);
  s[0] &= 248;
  s[31] &= 127;
  s[31] |= 64;
  let out = 0n;
  for (let i = 0; i < 32; i += 1) {
    out |= BigInt(s[i]) << BigInt(i * 8);
  }
  s.fill(0);
  return out;
}

function decodeX25519U(uBytes: Uint8Array): bigint {
  if (uBytes.length !== 32) {
    throw new Error('X25519 public key must be 32 bytes');
  }
  let out = 0n;
  for (let i = 0; i < 32; i += 1) {
    const byte = i === 31 ? uBytes[i] & 127 : uBytes[i];
    out |= BigInt(byte) << BigInt(i * 8);
  }
  return modP(out);
}

function encodeX25519U(u: bigint): Uint8Array {
  let v = modP(u);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function cswap(swap: bigint, a: bigint, b: bigint): [bigint, bigint] {
  const mask = 0n - swap;
  const dummy = mask & (a ^ b);
  return [a ^ dummy, b ^ dummy];
}

export function x25519ScalarMult(scalarBytes: Uint8Array, uBytes: Uint8Array): Uint8Array {
  const k = clampX25519Scalar(scalarBytes);
  const x1 = decodeX25519U(uBytes);

  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t -= 1) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;
    [x2, x3] = cswap(swap, x2, x3);
    [z2, z3] = cswap(swap, z2, z3);
    swap = kt;

    const A = modP(x2 + z2);
    const AA = modP(A * A);
    const B = modP(x2 - z2);
    const BB = modP(B * B);
    const E = modP(AA - BB);
    const C = modP(x3 + z3);
    const D = modP(x3 - z3);
    const DA = modP(D * A);
    const CB = modP(C * B);
    const sum = modP(DA + CB);
    const diff = modP(DA - CB);

    x3 = modP(sum * sum);
    z3 = modP(x1 * modP(diff * diff));
    x2 = modP(AA * BB);
    z2 = modP(E * modP(AA + modP(A24 * E)));
  }

  [x2, x3] = cswap(swap, x2, x3);
  [z2, z3] = cswap(swap, z2, z3);

  const invZ2 = modPowP(z2, P25519 - 2n);
  return encodeX25519U(modP(x2 * invZ2));
}

const X25519_BASEPOINT = (() => {
  const b = new Uint8Array(32);
  b[0] = 9;
  return b;
})();

export function x25519PublicFromPrivate(privateKey: Uint8Array): Uint8Array {
  return x25519ScalarMult(privateKey, X25519_BASEPOINT);
}

export function x25519GenerateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes(32);
  const publicKey = x25519PublicFromPrivate(privateKey);
  return { privateKey, publicKey };
}

const ZERO_32 = new Uint8Array(32);

export function x25519SharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  const shared = x25519ScalarMult(privateKey, peerPublicKey);
  // Reject all-zero output caused by contributory low-order curve points (RFC 7748 §6.1)
  if (constantTimeEqual(shared, ZERO_32)) {
    throw new Error('Rejected low-order X25519 peer public key');
  }
  return shared;
}

// ============================================================================
// 2. RFC 5869 HKDF-SHA256
// ============================================================================

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  if (length <= 0 || length > 255 * 32) {
    throw new Error('Invalid HKDF output length');
  }
  const effectiveSalt = salt.length > 0 ? salt : ZERO_32;
  const prk = hmacPure('SHA-256', effectiveSalt, ikm);

  const blocks = Math.ceil(length / 32);
  const okm = new Uint8Array(blocks * 32);
  let prev: Uint8Array = new Uint8Array(0);

  for (let i = 1; i <= blocks; i += 1) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[prev.length + info.length] = i;
    const t = hmacPure('SHA-256', prk, input);
    okm.set(t, (i - 1) * 32);
    prev = t;
  }

  prk.fill(0);
  return okm.subarray(0, length);
}

// ============================================================================
// 3. RFC 8439 ChaCha20-Poly1305 (256-bit AEAD)
// ============================================================================

function rotl32(v: number, c: number): number {
  return ((v << c) | (v >>> (32 - c))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl32(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl32(s[b] ^ s[c], 7);
}

function chacha20Block(
  keyWords: Uint32Array,
  counter: number,
  nonceWords: Uint32Array,
  outBytes: Uint8Array
): void {
  const state = new Uint32Array(16);
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;
  state.set(keyWords, 4);
  state[12] = counter >>> 0;
  state[13] = nonceWords[0];
  state[14] = nonceWords[1];
  state[15] = nonceWords[2];

  const working = new Uint32Array(state);
  for (let i = 0; i < 10; i += 1) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  const dv = new DataView(outBytes.buffer, outBytes.byteOffset, 64);
  for (let i = 0; i < 16; i += 1) {
    dv.setUint32(i * 4, (working[i] + state[i]) >>> 0, true);
  }
}

function parseKeyAndNonce(
  key: Uint8Array,
  nonce: Uint8Array
): { keyWords: Uint32Array; nonceWords: Uint32Array } {
  if (key.length !== 32) throw new Error('ChaCha20-Poly1305 key must be 32 bytes');
  if (nonce.length !== 12) throw new Error('ChaCha20-Poly1305 nonce must be 12 bytes');
  const kDv = new DataView(key.buffer, key.byteOffset, 32);
  const nDv = new DataView(nonce.buffer, nonce.byteOffset, 12);
  const keyWords = new Uint32Array(8);
  for (let i = 0; i < 8; i += 1) keyWords[i] = kDv.getUint32(i * 4, true);
  const nonceWords = new Uint32Array([
    nDv.getUint32(0, true),
    nDv.getUint32(4, true),
    nDv.getUint32(8, true),
  ]);
  return { keyWords, nonceWords };
}

function chacha20Xor(
  keyWords: Uint32Array,
  initialCounter: number,
  nonceWords: Uint32Array,
  input: Uint8Array
): Uint8Array {
  const out = new Uint8Array(input.length);
  const block = new Uint8Array(64);
  let counter = initialCounter;
  for (let off = 0; off < input.length; off += 64) {
    chacha20Block(keyWords, counter, nonceWords, block);
    counter = (counter + 1) >>> 0;
    const take = Math.min(64, input.length - off);
    for (let i = 0; i < take; i += 1) {
      out[off + i] = input[off + i] ^ block[i];
    }
  }
  block.fill(0);
  return out;
}

const P1305 = (1n << 130n) - 5n;

function poly1305Mac(otk: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  let r = 0n;
  for (let i = 0; i < 16; i += 1) {
    let b = otk[i];
    if (i === 3 || i === 7 || i === 11 || i === 15) b &= 15;
    if (i === 4 || i === 8 || i === 12) b &= 252;
    r |= BigInt(b) << BigInt(i * 8);
  }
  let s = 0n;
  for (let i = 0; i < 16; i += 1) {
    s |= BigInt(otk[16 + i]) << BigInt(i * 8);
  }

  let acc = 0n;

  const feedPadded = (data: Uint8Array) => {
    const fullEnd = data.length - (data.length % 16);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let off = 0; off < fullEnd; off += 16) {
      const lo = dv.getBigUint64(off, true);
      const hi = dv.getBigUint64(off + 8, true);
      const n = lo | (hi << 64n) | (1n << 128n);
      acc = ((acc + n) * r) % P1305;
    }
    if (fullEnd < data.length) {
      let n = 0n;
      for (let i = fullEnd; i < data.length; i += 1) {
        n |= BigInt(data[i]) << BigInt((i - fullEnd) * 8);
      }
      n |= 1n << 128n; // Pad to 16 bytes with zeros (RFC 8439 §2.8), then append high bit 0x01 at byte 16
      acc = ((acc + n) * r) % P1305;
    }
  };

  feedPadded(aad);
  feedPadded(ciphertext);

  const lensBlock = BigInt(aad.length) | (BigInt(ciphertext.length) << 64n) | (1n << 128n);
  acc = ((acc + lensBlock) * r) % P1305;
  const tagVal = (acc + s) & ((1n << 128n) - 1n);

  const tag = new Uint8Array(16);
  let v = tagVal;
  for (let i = 0; i < 16; i += 1) {
    tag[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return tag;
}

export function chacha20Poly1305Seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  const { keyWords, nonceWords } = parseKeyAndNonce(key, nonce);
  const block0 = new Uint8Array(64);
  chacha20Block(keyWords, 0, nonceWords, block0);
  const otk = block0.subarray(0, 32);

  const ciphertext = chacha20Xor(keyWords, 1, nonceWords, plaintext);
  const tag = poly1305Mac(otk, aad, ciphertext);

  keyWords.fill(0);
  block0.fill(0);

  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext, 0);
  out.set(tag, ciphertext.length);
  return out;
}

export function chacha20Poly1305Open(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (sealed.length < 16) {
    throw new Error('Ciphertext truncated (missing authentication tag)');
  }
  const { keyWords, nonceWords } = parseKeyAndNonce(key, nonce);
  const block0 = new Uint8Array(64);
  chacha20Block(keyWords, 0, nonceWords, block0);
  const otk = block0.subarray(0, 32);

  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const receivedTag = sealed.subarray(sealed.length - 16);
  const expectedTag = poly1305Mac(otk, aad, ciphertext);
  block0.fill(0);

  if (!constantTimeEqual(receivedTag, expectedTag)) {
    keyWords.fill(0);
    throw new Error('AEAD authentication failed (wrong key or tampered ciphertext)');
  }

  const plaintext = chacha20Xor(keyWords, 1, nonceWords, ciphertext);
  keyWords.fill(0);
  return plaintext;
}

// ============================================================================
// 4. Universal PBKDF2-HMAC-SHA256 & AES-256-GCM (WebCrypto + Pure-TS Fallback)
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Compress(state: Uint32Array, W: Uint32Array): void {
  for (let i = 16; i < 64; i += 1) {
    const w15 = W[i - 15];
    const w2 = W[i - 2];
    const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
  }

  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  let f = state[5];
  let g = state[6];
  let h = state[7];

  for (let i = 0; i < 64; i += 1) {
    const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
    const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0;
  state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0;
  state[7] = (state[7] + h) >>> 0;
}

/**
 * High-speed allocation-free PBKDF2-HMAC-SHA256 fallback (precomputes inner/outer SHA-256 pad states once).
 */
export function pbkdf2Sha256Pure(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number
): Uint8Array {
  if (iterations < 1 || dkLen < 1) {
    throw new Error('Invalid PBKDF2 parameters');
  }
  const normKey = password.length > 64 ? sha256Pure(password) : password;
  const ipadWords = new Uint32Array(64);
  const opadWords = new Uint32Array(64);
  const padBytes = new Uint8Array(64);
  const padDv = new DataView(padBytes.buffer);

  for (let i = 0; i < 64; i += 1) padBytes[i] = (normKey[i] ?? 0) ^ 0x36;
  for (let i = 0; i < 16; i += 1) ipadWords[i] = padDv.getUint32(i * 4, false);
  const innerMid = new Uint32Array(SHA256_IV);
  sha256Compress(innerMid, ipadWords);

  for (let i = 0; i < 64; i += 1) padBytes[i] = (normKey[i] ?? 0) ^ 0x5c;
  for (let i = 0; i < 16; i += 1) opadWords[i] = padDv.getUint32(i * 4, false);
  const outerMid = new Uint32Array(SHA256_IV);
  sha256Compress(outerMid, opadWords);
  padBytes.fill(0);

  const blocks = Math.ceil(dkLen / 32);
  const derived = new Uint8Array(blocks * 32);
  const W = new Uint32Array(64);
  const state = new Uint32Array(8);
  const uWords = new Uint32Array(8);
  const tWords = new Uint32Array(8);

  const saltInt = new Uint8Array(salt.length + 4);
  saltInt.set(salt, 0);
  const saltDv = new DataView(saltInt.buffer);

  for (let blockIdx = 1; blockIdx <= blocks; blockIdx += 1) {
    saltDv.setUint32(salt.length, blockIdx, false);
    const u1 = hmacPure('SHA-256', normKey, saltInt);
    const u1Dv = new DataView(u1.buffer, u1.byteOffset, 32);
    for (let w = 0; w < 8; w += 1) {
      const word = u1Dv.getUint32(w * 4, false);
      uWords[w] = word;
      tWords[w] = word;
    }

    for (let iter = 2; iter <= iterations; iter += 1) {
      // Inner hash of 64-byte ipad + 32-byte `uWords` (total 96 bytes = 768 bits)
      state.set(innerMid);
      for (let w = 0; w < 8; w += 1) W[w] = uWords[w];
      W[8] = 0x80000000;
      for (let w = 9; w < 15; w += 1) W[w] = 0;
      W[15] = 768;
      sha256Compress(state, W);

      // Outer hash of 64-byte opad + 32-byte `state` (total 96 bytes = 768 bits)
      for (let w = 0; w < 8; w += 1) W[w] = state[w];
      W[8] = 0x80000000;
      for (let w = 9; w < 15; w += 1) W[w] = 0;
      W[15] = 768;
      state.set(outerMid);
      sha256Compress(state, W);

      for (let w = 0; w < 8; w += 1) {
        uWords[w] = state[w];
        tWords[w] = (tWords[w] ^ state[w]) >>> 0;
      }
    }

    const outDv = new DataView(derived.buffer, (blockIdx - 1) * 32, 32);
    for (let w = 0; w < 8; w += 1) {
      outDv.setUint32(w * 4, tWords[w], false);
    }
  }

  innerMid.fill(0);
  outerMid.fill(0);
  uWords.fill(0);
  tWords.fill(0);
  return derived.subarray(0, dkLen);
}

export async function pbkdf2Sha256Universal(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const pwBuf = new Uint8Array(password.length);
    pwBuf.set(password);
    const saltBuf = new Uint8Array(salt.length);
    saltBuf.set(salt);
    const baseKey = await globalThis.crypto.subtle.importKey('raw', pwBuf, 'PBKDF2', false, [
      'deriveBits',
    ]);
    pwBuf.fill(0);
    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuf,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      dkLen * 8
    );
    return new Uint8Array(bits);
  }
  return pbkdf2Sha256Pure(password, salt, iterations, dkLen);
}

// --- Pure-TS FIPS-197 AES-256 + NIST SP 800-38D GCM ---

const AES_SBOX = (() => {
  const sbox = new Uint8Array(256);
  const p = new Uint8Array(256);
  const q = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    p[i] = x;
    q[x] = i;
    // Multiply by 0x03 (`x + 1`), a generator of GF(2^8)* modulo x^8 + x^4 + x^3 + x + 1
    x ^= ((x << 1) ^ (x & 0x80 ? 0x11b : 0)) & 0xff;
  }
  sbox[0] = 0x63;
  for (let i = 1; i < 256; i += 1) {
    const inv = i === 1 ? 1 : p[255 - q[i]];
    let s = inv;
    for (let r = 1; r <= 4; r += 1) {
      s ^= ((inv << r) | (inv >>> (8 - r))) & 0xff;
    }
    sbox[i] = s ^ 0x63;
  }
  return sbox;
})();

function gfMul2(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
}

function aes256ExpandKey(key: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const rk = new Uint8Array(240); // 15 round keys × 16 bytes
  rk.set(key, 0);
  let rcon = 1;
  const temp = new Uint8Array(4);

  for (let word = 8; word < 60; word += 1) {
    const prevOff = (word - 1) * 4;
    temp[0] = rk[prevOff];
    temp[1] = rk[prevOff + 1];
    temp[2] = rk[prevOff + 2];
    temp[3] = rk[prevOff + 3];

    if (word % 8 === 0) {
      const t0 = temp[0];
      temp[0] = AES_SBOX[temp[1]] ^ rcon;
      temp[1] = AES_SBOX[temp[2]];
      temp[2] = AES_SBOX[temp[3]];
      temp[3] = AES_SBOX[t0];
      rcon = gfMul2(rcon);
    } else if (word % 8 === 4) {
      temp[0] = AES_SBOX[temp[0]];
      temp[1] = AES_SBOX[temp[1]];
      temp[2] = AES_SBOX[temp[2]];
      temp[3] = AES_SBOX[temp[3]];
    }

    const backOff = (word - 8) * 4;
    const dstOff = word * 4;
    rk[dstOff] = rk[backOff] ^ temp[0];
    rk[dstOff + 1] = rk[backOff + 1] ^ temp[1];
    rk[dstOff + 2] = rk[backOff + 2] ^ temp[2];
    rk[dstOff + 3] = rk[backOff + 3] ^ temp[3];
  }
  return rk;
}

function aes256EncryptBlock(rk: Uint8Array, input: Uint8Array, output: Uint8Array): void {
  const s = new Uint8Array(16);
  const t = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) s[i] = input[i] ^ rk[i];

  for (let round = 1; round <= 14; round += 1) {
    // SubBytes + ShiftRows
    t[0] = AES_SBOX[s[0]];
    t[1] = AES_SBOX[s[5]];
    t[2] = AES_SBOX[s[10]];
    t[3] = AES_SBOX[s[15]];
    t[4] = AES_SBOX[s[4]];
    t[5] = AES_SBOX[s[9]];
    t[6] = AES_SBOX[s[14]];
    t[7] = AES_SBOX[s[3]];
    t[8] = AES_SBOX[s[8]];
    t[9] = AES_SBOX[s[13]];
    t[10] = AES_SBOX[s[2]];
    t[11] = AES_SBOX[s[7]];
    t[12] = AES_SBOX[s[12]];
    t[13] = AES_SBOX[s[1]];
    t[14] = AES_SBOX[s[6]];
    t[15] = AES_SBOX[s[11]];

    const rkOff = round * 16;
    if (round < 14) {
      for (let col = 0; col < 16; col += 4) {
        const a0 = t[col];
        const a1 = t[col + 1];
        const a2 = t[col + 2];
        const a3 = t[col + 3];
        const sum = a0 ^ a1 ^ a2 ^ a3;
        s[col] = a0 ^ sum ^ gfMul2(a0 ^ a1) ^ rk[rkOff + col];
        s[col + 1] = a1 ^ sum ^ gfMul2(a1 ^ a2) ^ rk[rkOff + col + 1];
        s[col + 2] = a2 ^ sum ^ gfMul2(a2 ^ a3) ^ rk[rkOff + col + 2];
        s[col + 3] = a3 ^ sum ^ gfMul2(a3 ^ a0) ^ rk[rkOff + col + 3];
      }
    } else {
      for (let i = 0; i < 16; i += 1) {
        output[i] = t[i] ^ rk[rkOff + i];
      }
    }
  }
}

const GCM_R = 0xe1000000000000000000000000000000n;
const MASK128 = (1n << 128n) - 1n;

function bytes16ToBigIntBE(b: Uint8Array, off = 0): bigint {
  const dv = new DataView(b.buffer, b.byteOffset + off, 16);
  return (dv.getBigUint64(0, false) << 64n) | dv.getBigUint64(8, false);
}

function bigIntToBytes16BE(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, (v >> 64n) & 0xffffffffffffffffn, false);
  dv.setBigUint64(8, v & 0xffffffffffffffffn, false);
  return out;
}

function ghashMul(x: bigint, y: bigint): bigint {
  let z = 0n;
  let v = y;
  for (let i = 127; i >= 0; i -= 1) {
    if ((x >> BigInt(i)) & 1n) {
      z ^= v;
    }
    const lsb = v & 1n;
    v >>= 1n;
    if (lsb) {
      v ^= GCM_R;
    }
  }
  return z & MASK128;
}

function ghashCompute(H: bigint, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  let y = 0n;
  const tmp = new Uint8Array(16);

  const feed = (data: Uint8Array) => {
    let off = 0;
    for (; off + 16 <= data.length; off += 16) {
      y = ghashMul(y ^ bytes16ToBigIntBE(data, off), H);
    }
    if (off < data.length) {
      tmp.fill(0);
      tmp.set(data.subarray(off), 0);
      y = ghashMul(y ^ bytes16ToBigIntBE(tmp, 0), H);
    }
  };

  feed(aad);
  feed(ciphertext);

  const lenBits = (BigInt(aad.length) * 8n) << 64n | (BigInt(ciphertext.length) * 8n);
  y = ghashMul(y ^ lenBits, H);
  return bigIntToBytes16BE(y);
}

function aes256Gctr(rk: Uint8Array, icb: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  const cb = new Uint8Array(icb);
  const cbDv = new DataView(cb.buffer);
  const ks = new Uint8Array(16);

  for (let off = 0; off < input.length; off += 16) {
    aes256EncryptBlock(rk, cb, ks);
    const take = Math.min(16, input.length - off);
    for (let i = 0; i < take; i += 1) {
      out[off + i] = input[off + i] ^ ks[i];
    }
    cbDv.setUint32(12, (cbDv.getUint32(12, false) + 1) >>> 0, false);
  }
  ks.fill(0);
  return out;
}

export function aes256GcmSealPure(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (iv.length !== 12) throw new Error('AES-256-GCM IV must be 12 bytes');
  const rk = aes256ExpandKey(key);
  const hBytes = new Uint8Array(16);
  aes256EncryptBlock(rk, new Uint8Array(16), hBytes);
  const H = bytes16ToBigIntBE(hBytes);

  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;

  const icb = new Uint8Array(j0);
  icb[15] = 2;
  const ciphertext = aes256Gctr(rk, icb, plaintext);
  const sTag = ghashCompute(H, aad, ciphertext);
  const tagMask = new Uint8Array(16);
  aes256EncryptBlock(rk, j0, tagMask);
  rk.fill(0);

  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext, 0);
  for (let i = 0; i < 16; i += 1) {
    out[ciphertext.length + i] = sTag[i] ^ tagMask[i];
  }
  return out;
}

export function aes256GcmOpenPure(
  key: Uint8Array,
  iv: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (iv.length !== 12) throw new Error('AES-256-GCM IV must be 12 bytes');
  if (sealed.length < 16) throw new Error('AES-256-GCM ciphertext truncated');
  const rk = aes256ExpandKey(key);
  const hBytes = new Uint8Array(16);
  aes256EncryptBlock(rk, new Uint8Array(16), hBytes);
  const H = bytes16ToBigIntBE(hBytes);

  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;

  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const receivedTag = sealed.subarray(sealed.length - 16);
  const sTag = ghashCompute(H, aad, ciphertext);
  const tagMask = new Uint8Array(16);
  aes256EncryptBlock(rk, j0, tagMask);

  const expectedTag = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) expectedTag[i] = sTag[i] ^ tagMask[i];

  if (!constantTimeEqual(receivedTag, expectedTag)) {
    rk.fill(0);
    throw new Error('AES-256-GCM authentication failed (wrong passphrase or corrupted payload)');
  }

  const icb = new Uint8Array(j0);
  icb[15] = 2;
  const plaintext = aes256Gctr(rk, icb, ciphertext);
  rk.fill(0);
  return plaintext;
}

export async function aes256GcmSealUniversal(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const keyCopy = new Uint8Array(key.length);
    keyCopy.set(key);
    const ivCopy = new Uint8Array(iv.length);
    ivCopy.set(iv);
    const ptCopy = new Uint8Array(plaintext.length);
    ptCopy.set(plaintext);
    const aadCopy = new Uint8Array(aad.length);
    aadCopy.set(aad);

    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', keyCopy, 'AES-GCM', false, [
      'encrypt',
    ]);
    keyCopy.fill(0);
    const buf = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivCopy, additionalData: aadCopy, tagLength: 128 },
      cryptoKey,
      ptCopy
    );
    return new Uint8Array(buf);
  }
  return aes256GcmSealPure(key, iv, plaintext, aad);
}

export async function aes256GcmOpenUniversal(
  key: Uint8Array,
  iv: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const keyCopy = new Uint8Array(key.length);
    keyCopy.set(key);
    const ivCopy = new Uint8Array(iv.length);
    ivCopy.set(iv);
    const ctCopy = new Uint8Array(sealed.length);
    ctCopy.set(sealed);
    const aadCopy = new Uint8Array(aad.length);
    aadCopy.set(aad);

    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', keyCopy, 'AES-GCM', false, [
      'decrypt',
    ]);
    keyCopy.fill(0);
    const buf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivCopy, additionalData: aadCopy, tagLength: 128 },
      cryptoKey,
      ctCopy
    );
    return new Uint8Array(buf);
  }
  return aes256GcmOpenPure(key, iv, sealed, aad);
}
