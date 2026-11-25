// RFC 9562 UUID v4 & monotonic time-ordered UUID v7 generator

export type UuidVersion = 'v4' | 'v7';

export interface UuidFormatOptions {
  uppercase?: boolean;
  hyphens?: boolean;
}

let lastV7Ms = 0;
let lastV7Seq = 0;

function formatUuidBytes(bytes: Uint8Array, opts?: UuidFormatOptions): string {
  let hex = '';
  for (let i = 0; i < 16; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  const hyphenated =
    opts?.hyphens === false
      ? hex
      : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return opts?.uppercase ? hyphenated.toUpperCase() : hyphenated;
}

/**
 * Generates monotonic time-ordered UUIDv7 per RFC 9562 §5.7:
 * - bits 0..47:  48-bit Unix epoch milliseconds
 * - bits 48..51: `ver = 0b0111` (7)
 * - bits 52..63: 12-bit `rand_a` (monotonically incremented within the same millisecond)
 * - bits 64..65: `var = 0b10`
 * - bits 66..127: 62-bit CSPRNG random payload
 */
export function generateUuidV7(nowMs = Date.now(), opts?: UuidFormatOptions): string {
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);

  let ts = Math.max(0, Math.floor(nowMs));
  let seq: number;
  if (ts === lastV7Ms) {
    lastV7Seq = (lastV7Seq + 1) & 0x0fff;
    if (lastV7Seq === 0) {
      ts += 1;
      lastV7Ms = ts;
    }
    seq = lastV7Seq;
  } else {
    lastV7Ms = ts;
    lastV7Seq = ((rand[6] & 0x0f) << 8) | rand[7];
    seq = lastV7Seq;
  }

  const tsBig = BigInt(ts);
  rand[0] = Number((tsBig >> 40n) & 0xffn);
  rand[1] = Number((tsBig >> 32n) & 0xffn);
  rand[2] = Number((tsBig >> 24n) & 0xffn);
  rand[3] = Number((tsBig >> 16n) & 0xffn);
  rand[4] = Number((tsBig >> 8n) & 0xffn);
  rand[5] = Number(tsBig & 0xffn);

  rand[6] = 0x70 | ((seq >>> 8) & 0x0f);
  rand[7] = seq & 0xff;
  rand[8] = (rand[8] & 0x3f) | 0x80;

  return formatUuidBytes(rand, opts);
}

/**
 * Generates RFC 9562 §5.4 UUIDv4:
 * automatically falls back to `crypto.getRandomValues` bit-masking on plain-HTTP private LAN origins
 * where browsers disable `crypto.randomUUID`.
 */
export function generateUuidV4(opts?: UuidFormatOptions): string {
  if (typeof crypto.randomUUID === 'function') {
    let id: string = crypto.randomUUID();
    if (opts?.hyphens === false) id = id.replace(/-/g, '');
    if (opts?.uppercase) id = id.toUpperCase();
    return id;
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  rand[6] = (rand[6] & 0x0f) | 0x40;
  rand[8] = (rand[8] & 0x3f) | 0x80;
  return formatUuidBytes(rand, opts);
}

export function generateUuidBatch(
  version: UuidVersion,
  count: number,
  opts?: UuidFormatOptions
): string[] {
  const safeCount = Math.min(100, Math.max(1, Math.floor(count)));
  const out: string[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    if (version === 'v4') {
      out.push(generateUuidV4(opts));
    } else {
      out.push(generateUuidV7(Date.now(), opts));
    }
  }
  return out;
}
