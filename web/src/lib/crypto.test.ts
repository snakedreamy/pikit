import { describe, expect, it } from 'vitest';
import {
  aes256GcmOpenPure,
  aes256GcmOpenUniversal,
  aes256GcmSealPure,
  aes256GcmSealUniversal,
  base64UrlToBytes,
  bytesToBase64Url,
  chacha20Poly1305Open,
  chacha20Poly1305Seal,
  hkdfSha256,
  pbkdf2Sha256Pure,
  pbkdf2Sha256Universal,
  x25519PublicFromPrivate,
  x25519SharedSecret,
} from './crypto';

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Cross-context cryptographic primitives (RFC 7748, RFC 5869, RFC 8439, NIST SP 800-38D)', () => {
  it('matches RFC 7748 §6.1 X25519 Diffie-Hellman test vectors and rejects low-order points', () => {
    const alicePriv = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bobPriv = fromHex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');

    const alicePub = x25519PublicFromPrivate(alicePriv);
    const bobPub = x25519PublicFromPrivate(bobPriv);

    expect(toHex(alicePub)).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(toHex(bobPub)).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');

    const sharedA = x25519SharedSecret(alicePriv, bobPub);
    const sharedB = x25519SharedSecret(bobPriv, alicePub);
    expect(toHex(sharedA)).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
    expect(toHex(sharedB)).toBe(toHex(sharedA));

    // All-zero low-order point must be rejected
    expect(() => x25519SharedSecret(alicePriv, new Uint8Array(32))).toThrow();
  });

  it('matches RFC 5869 Appendix A.1 HKDF-SHA256 test vector', () => {
    const ikm = fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const salt = fromHex('000102030405060708090a0b0c');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    const okm = hkdfSha256(ikm, salt, info, 42);
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
    );
  });

  it('matches RFC 8439 §2.8.2 ChaCha20-Poly1305 AEAD test vector and rejects tampered data', () => {
    const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = fromHex('070000004041424344454647');
    const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
    const pt = new TextEncoder().encode(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
    );

    const sealed = chacha20Poly1305Seal(key, nonce, pt, aad);
    const tag = sealed.subarray(sealed.length - 16);
    expect(toHex(tag)).toBe('1ae10b594f09e26a7e902ecbd0600691');

    const opened = chacha20Poly1305Open(key, nonce, sealed, aad);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(pt));

    // Tampering with ciphertext or AAD must fail authentication
    const tampered = new Uint8Array(sealed);
    tampered[0] ^= 1;
    expect(() => chacha20Poly1305Open(key, nonce, tampered, aad)).toThrow();
    expect(() => chacha20Poly1305Open(key, nonce, sealed, new Uint8Array([1]))).toThrow();
  });

  it('verifies bit-exact interoperability between WebCrypto and pure-TS PBKDF2 + AES-256-GCM', async () => {
    const pw = new TextEncoder().encode('correct-horse-battery-staple');
    const salt = fromHex('00112233445566778899aabbccddeeff');

    const keyWeb = await pbkdf2Sha256Universal(pw, salt, 4096, 32);
    const keyPure = pbkdf2Sha256Pure(pw, salt, 4096, 32);
    expect(toHex(keyPure)).toBe(toHex(keyWeb));

    const iv = fromHex('cafebabefacedbaddecaf888');
    const aad = new TextEncoder().encode('pikbay-aead-header-v1');
    const msg = new TextEncoder().encode('Sensitive homelab WireGuard private key & token');

    // Encrypt with WebCrypto -> Decrypt with Pure-TS fallback
    const sealedByWeb = await aes256GcmSealUniversal(keyWeb, iv, msg, aad);
    const openedByPure = aes256GcmOpenPure(keyPure, iv, sealedByWeb, aad);
    expect(new TextDecoder().decode(openedByPure)).toBe(new TextDecoder().decode(msg));

    // Encrypt with Pure-TS fallback -> Decrypt with WebCrypto
    const sealedByPure = aes256GcmSealPure(keyPure, iv, msg, aad);
    expect(toHex(sealedByPure)).toBe(toHex(sealedByWeb));
    const openedByWeb = await aes256GcmOpenUniversal(keyWeb, iv, sealedByPure, aad);
    expect(new TextDecoder().decode(openedByWeb)).toBe(new TextDecoder().decode(msg));

    // Base64URL round-trip
    expect(toHex(base64UrlToBytes(bytesToBase64Url(sealedByPure)))).toBe(toHex(sealedByPure));
  });
});
