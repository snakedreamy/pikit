// HMAC signing (SHA-1 / SHA-256 / SHA-384 / SHA-512) via Web Crypto with automatic plain-HTTP pure-TS fallback

import { hmacUniversal } from '../../../../lib/digest';

export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HmacKeyFormat = 'utf8' | 'hex';
export type HmacOutFormat = 'hex' | 'base64';

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  const clean = hex.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (!clean) return new Uint8Array(new ArrayBuffer(0));
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return null;
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeOut(bytes: Uint8Array, fmt: HmacOutFormat): string {
  if (fmt === 'base64') {
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

export async function computeHmac(
  message: string,
  secret: string,
  alg: HmacAlgorithm,
  keyFormat: HmacKeyFormat = 'utf8',
  outFormat: HmacOutFormat = 'hex'
): Promise<{ ok: boolean; output: string; error?: 'empty_key' | 'invalid_hex_key' }> {
  let keyBytes: Uint8Array<ArrayBuffer> | null;
  if (keyFormat === 'hex') {
    keyBytes = hexToBytes(secret);
    if (!keyBytes) return { ok: false, output: '', error: 'invalid_hex_key' };
  } else {
    keyBytes = new TextEncoder().encode(secret);
  }

  if (keyBytes.byteLength === 0) {
    return { ok: false, output: '', error: 'empty_key' };
  }

  const msgBytes = new TextEncoder().encode(message);
  const sig = await hmacUniversal(alg, keyBytes, msgBytes);
  return {
    ok: true,
    output: encodeOut(sig, outFormat),
  };
}
