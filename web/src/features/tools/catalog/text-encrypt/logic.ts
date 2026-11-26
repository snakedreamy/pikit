// Offline passphrase-based authenticated text encryption & decryption
// (PBKDF2-HMAC-SHA256 + 128-bit random salt + 96-bit random IV + 256-bit AES-GCM with header AAD;
//  uses native WebCrypto in secure contexts and bit-exact pure-TS fallback on plain-HTTP LAN)

import {
  aes256GcmOpenUniversal,
  aes256GcmSealUniversal,
  base64UrlToBytes,
  bytesToBase64Url,
  pbkdf2Sha256Universal,
  randomBytes,
  wipeBytes,
} from '../../../../lib/crypto';

const MAGIC = [0x50, 0x4b, 0x42, 0x01] as const; // "PKB\x01"
const HEADER_BYTES = 36; // 4B magic (0..4) + 4B iterations (4..8) + 16B salt (8..24) + 12B IV (24..36)
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 2_000_000;
const ARMOR_PREFIX = 'PKB1.';

export type TextCipherResult =
  | { ok: true; output: string; iterations: number }
  | { ok: false; error: string };

export async function encryptTextWithPassphrase(
  plaintext: string,
  passphrase: string,
  iterations = 210_000
): Promise<TextCipherResult> {
  if (!passphrase) {
    return { ok: false, error: 'passphrase_required' };
  }
  if (!plaintext) {
    return { ok: true, output: '', iterations };
  }

  const safeIter = Math.max(MIN_ITERATIONS, Math.min(MAX_ITERATIONS, Math.floor(iterations)));
  const salt = randomBytes(16);
  const iv = randomBytes(12);

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(4, safeIter, false);
  header.set(salt, 8);
  header.set(iv, 24);

  const enc = new TextEncoder();
  const pwBytes = enc.encode(passphrase);
  const ptBytes = enc.encode(plaintext);

  try {
    const key = await pbkdf2Sha256Universal(pwBytes, salt, safeIter, 32);
    const sealed = await aes256GcmSealUniversal(key, iv, ptBytes, header);
    wipeBytes(key);
    wipeBytes(pwBytes);
    wipeBytes(ptBytes);

    const packet = new Uint8Array(HEADER_BYTES + sealed.byteLength);
    packet.set(header, 0);
    packet.set(sealed, HEADER_BYTES);
    return {
      ok: true,
      output: `${ARMOR_PREFIX}${bytesToBase64Url(packet)}`,
      iterations: safeIter,
    };
  } catch (err) {
    wipeBytes(pwBytes);
    wipeBytes(ptBytes);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'encrypt_failed',
    };
  }
}

export async function decryptTextWithPassphrase(
  armored: string,
  passphrase: string
): Promise<TextCipherResult> {
  const compact = armored.replace(/\s+/g, '');
  if (!compact) {
    return { ok: true, output: '', iterations: 0 };
  }
  if (!passphrase) {
    return { ok: false, error: 'passphrase_required' };
  }
  if (!compact.startsWith(ARMOR_PREFIX)) {
    return { ok: false, error: 'invalid_envelope' };
  }

  let packet: Uint8Array;
  try {
    packet = base64UrlToBytes(compact.slice(ARMOR_PREFIX.length));
  } catch {
    return { ok: false, error: 'invalid_envelope' };
  }

  if (packet.byteLength < HEADER_BYTES + 16) {
    return { ok: false, error: 'invalid_envelope' };
  }
  for (let i = 0; i < 4; i += 1) {
    if (packet[i] !== MAGIC[i]) {
      return { ok: false, error: 'invalid_envelope' };
    }
  }

  const iterations = new DataView(packet.buffer, packet.byteOffset, HEADER_BYTES).getUint32(
    4,
    false
  );
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return { ok: false, error: 'invalid_iterations' };
  }

  const header = packet.subarray(0, HEADER_BYTES);
  const salt = packet.subarray(8, 24);
  const iv = packet.subarray(24, 36);
  const sealed = packet.subarray(HEADER_BYTES);
  const pwBytes = new TextEncoder().encode(passphrase);

  try {
    const key = await pbkdf2Sha256Universal(pwBytes, salt, iterations, 32);
    wipeBytes(pwBytes);
    const ptBytes = await aes256GcmOpenUniversal(key, iv, sealed, header);
    wipeBytes(key);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(ptBytes);
    wipeBytes(ptBytes);
    return { ok: true, output: decoded, iterations };
  } catch {
    wipeBytes(pwBytes);
    return { ok: false, error: 'auth_failed' };
  }
}
