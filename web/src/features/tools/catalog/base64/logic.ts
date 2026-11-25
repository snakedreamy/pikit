// Pure Base64 / Base64URL codec (zero DOM, zero network) supporting UTF-8 text and arbitrary binary byte buffers

export type Base64Variant = 'standard' | 'urlsafe';

export interface Base64Result {
  ok: boolean;
  output: string;
  byteLength: number;
}

export interface DecodedBase64Payload extends Base64Result {
  decodedBytes: Uint8Array | null;
}

export function encodeBytesBase64(
  bytes: Uint8Array,
  variant: Base64Variant = 'standard'
): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  const b64 = btoa(binary);
  return variant === 'urlsafe'
    ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    : b64;
}

export function decodeBase64ToBytes(input: string): Uint8Array | null {
  const trimmed = input.trim().replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!trimmed) return new Uint8Array(0);

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  if (normalized.length % 4 === 1) return null;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function encodeUtf8Base64(input: string, variant: Base64Variant = 'standard'): Base64Result {
  const bytes = new TextEncoder().encode(input);
  return {
    ok: true,
    output: encodeBytesBase64(bytes, variant),
    byteLength: bytes.length,
  };
}

export function decodeBase64Payload(input: string): DecodedBase64Payload {
  const bytes = decodeBase64ToBytes(input);
  if (!bytes) {
    return { ok: false, output: '', byteLength: 0, decodedBytes: null };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      ok: true,
      output: text,
      byteLength: bytes.length,
      decodedBytes: bytes,
    };
  } catch {
    return { ok: false, output: '', byteLength: bytes.length, decodedBytes: bytes };
  }
}

export function decodeUtf8Base64(input: string): Base64Result {
  const { ok, output, byteLength } = decodeBase64Payload(input);
  return { ok, output, byteLength };
}
