// End-to-end cryptographic protocol for `/drop` (X25519 + 6-digit PIN HKDF-SHA256 + mutual MAC + 64 KiB ChaCha20-Poly1305 AEAD)

import {
  base64UrlToBytes,
  bytesToBase64Url,
  chacha20Poly1305Open,
  chacha20Poly1305Seal,
  constantTimeEqual,
  hkdfSha256,
  randomBytes,
  wipeBytes,
  x25519GenerateKeyPair,
  x25519SharedSecret,
} from '../../lib/crypto';
import { hmacPure } from '../../lib/digest';

export const DROP_FRAME_META = 0x01;
export const DROP_FRAME_CHUNK = 0x02;
export const DROP_FRAME_EOF = 0x03;

export const DROP_HEADER_BYTES = 9; // 1-byte kind + 8-byte big-endian sequence number
export const DROP_TAG_BYTES = 16;
export const DROP_FRAME_OVERHEAD_BYTES = DROP_HEADER_BYTES + DROP_TAG_BYTES; // 25 bytes per frame
export const DROP_MAX_WIRE_FRAME_BYTES = 64 * 1024; // Matches backend `MAX_RELAY_BINARY_BYTES` (65,536 bytes)
export const DROP_CHUNK_PLAINTEXT_BYTES = 64 * 1024 - 64; // 65,472 bytes -> max wire frame 65,497 <= 65,536 bytes
export const DROP_ENVELOPE_WIRE_ALLOWANCE_BYTES = 4096; // Matches backend `DROP_ENVELOPE_WIRE_ALLOWANCE_BYTES`

/**
 * Computes the exact WebSocket binary relay budget enforced by the server for `maxRelayMb`,
 * including per-chunk AEAD headers/tags and the `META` + `EOF` control frame envelope.
 */
export function computeDropMaxWireBytes(maxRelayMb: number): number {
  const maxPlain = Math.max(0, Math.floor(maxRelayMb)) * 1024 * 1024;
  const maxChunks = Math.ceil(maxPlain / DROP_CHUNK_PLAINTEXT_BYTES);
  return (
    maxPlain +
    maxChunks * DROP_FRAME_OVERHEAD_BYTES +
    DROP_ENVELOPE_WIRE_ALLOWANCE_BYTES
  );
}

/**
 * Computes the exact total ciphertext wire bytes that a transfer will emit across `META` + `CHUNK`s + `EOF`.
 */
export function computeDropTransferWireBytes(
  metaPlainBytes: number,
  totalBytes: number,
  totalChunks: number,
  eofPlainBytes: number
): number {
  return (
    DROP_FRAME_OVERHEAD_BYTES +
    metaPlainBytes +
    totalBytes +
    totalChunks * DROP_FRAME_OVERHEAD_BYTES +
    DROP_FRAME_OVERHEAD_BYTES +
    eofPlainBytes
  );
}

export interface DropTransferMeta {
  kind: 'text' | 'file';
  fileName?: string;
  mimeType: string;
  totalBytes: number;
  totalChunks: number;
}

export interface DropTransferEof {
  totalBytes: number;
  totalChunks: number;
}

export interface EphemeralDropIdentity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  salt: Uint8Array;
  pubKeyB64: string;
  saltB64: string;
}

export interface DropCryptoSession {
  readonly myConfirmMacB64: string;
  readonly fingerprint: string;
  verifyPeerConfirmMac: (peerMacB64: string) => boolean;
  computeDoneAckMac: (totalBytes: number, totalChunks: number) => string;
  verifyDoneAckMac: (macB64: string, totalBytes: number, totalChunks: number) => boolean;
  sealS2RFrame: (kind: number, seq: number, plaintext: Uint8Array) => Uint8Array;
  openS2RFrame: (
    frame: Uint8Array,
    expectedSeq: number
  ) => { kind: number; plaintext: Uint8Array };
  destroy: () => void;
}

export function normalizeSixDigitCode(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 6);
}

export function isValidSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function formatSixDigitCode(code: string): string {
  const digits = normalizeSixDigitCode(code);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}`;
}

export function sanitizeTransferFileName(rawName: string | undefined): string {
  if (!rawName) return 'drop-payload.bin';
  // Strip directory paths, NUL/control characters, and leading dots
  const base = rawName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\x00-\x1f\x7f]+/g, '')
    .trim()
    .replace(/^\.+/, '');
  if (!base) return 'drop-payload.bin';
  return base.slice(0, 180);
}

export function createEphemeralDropIdentity(): EphemeralDropIdentity {
  const { privateKey, publicKey } = x25519GenerateKeyPair();
  const salt = randomBytes(16);
  return {
    privateKey,
    publicKey,
    salt,
    pubKeyB64: bytesToBase64Url(publicKey),
    saltB64: bytesToBase64Url(salt),
  };
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const arr of arrays) total += arr.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const arr of arrays) {
    out.set(arr, off);
    off += arr.length;
  }
  return out;
}

function writeSeqBE64(target: Uint8Array, offset: number, seq: number): void {
  const dv = new DataView(target.buffer, target.byteOffset + offset, 8);
  dv.setBigUint64(0, BigInt(seq), false);
}

function readSeqBE64(source: Uint8Array, offset: number): number {
  const dv = new DataView(source.buffer, source.byteOffset + offset, 8);
  const val = dv.getBigUint64(0, false);
  if (val > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Sequence number overflow');
  }
  return Number(val);
}

export function deriveDropCryptoSession(params: {
  role: 'sender' | 'receiver';
  code: string;
  myPrivateKey: Uint8Array;
  peerPubKeyB64: string;
  senderPubKeyB64: string;
  receiverPubKeyB64: string;
  senderSaltB64: string;
  receiverSaltB64: string;
}): DropCryptoSession {
  if (!isValidSixDigitCode(params.code)) {
    throw new Error('Invalid 6-digit pairing code');
  }

  const peerPub = base64UrlToBytes(params.peerPubKeyB64);
  const senderPub = base64UrlToBytes(params.senderPubKeyB64);
  const receiverPub = base64UrlToBytes(params.receiverPubKeyB64);
  const senderSalt = base64UrlToBytes(params.senderSaltB64);
  const receiverSalt = base64UrlToBytes(params.receiverSaltB64);

  if (senderPub.length !== 32 || receiverPub.length !== 32 || peerPub.length !== 32) {
    throw new Error('Invalid X25519 public key length');
  }
  if (senderSalt.length < 16 || receiverSalt.length < 16) {
    throw new Error('Invalid HKDF salt length');
  }

  const enc = new TextEncoder();
  const shared = x25519SharedSecret(params.myPrivateKey, peerPub);
  const pinBytes = enc.encode(`pikbay-drop-pin:${params.code}`);
  const ikm = concatBytes(shared, pinBytes);
  const salt = concatBytes(senderSalt, receiverSalt);
  const info = concatBytes(enc.encode('pikbay-drop-v1-kdf'), senderPub, receiverPub);

  const okm = hkdfSha256(ikm, salt, info, 104);
  wipeBytes(shared);
  wipeBytes(pinBytes);
  wipeBytes(ikm);

  const s2rKey = okm.slice(0, 32);
  const macKey = okm.slice(32, 64);
  const s2rNoncePrefix = okm.slice(64, 68);
  const fpBytes = okm.slice(68, 72);
  const ackKey = okm.slice(72, 104);
  wipeBytes(okm);

  const transcript = concatBytes(senderPub, receiverPub, senderSalt, receiverSalt);
  const senderMac = hmacPure(
    'SHA-256',
    macKey,
    concatBytes(enc.encode('pikbay-drop-confirm:sender'), transcript)
  );
  const receiverMac = hmacPure(
    'SHA-256',
    macKey,
    concatBytes(enc.encode('pikbay-drop-confirm:receiver'), transcript)
  );
  wipeBytes(macKey);

  const myMac = params.role === 'sender' ? senderMac : receiverMac;
  const expectedPeerMac = params.role === 'sender' ? receiverMac : senderMac;
  const fingerprint = Array.from(fpBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const computeExpectedDoneAck = (totalBytes: number, totalChunks: number): Uint8Array =>
    hmacPure(
      'SHA-256',
      ackKey,
      concatBytes(
        enc.encode(`pikbay-drop-done:${Math.floor(totalBytes)}:${Math.floor(totalChunks)}:`),
        transcript
      )
    );

  return {
    myConfirmMacB64: bytesToBase64Url(myMac),
    fingerprint,
    verifyPeerConfirmMac(peerMacB64: string): boolean {
      try {
        const candidate = base64UrlToBytes(peerMacB64);
        return constantTimeEqual(candidate, expectedPeerMac);
      } catch {
        return false;
      }
    },
    computeDoneAckMac(totalBytes: number, totalChunks: number): string {
      return bytesToBase64Url(computeExpectedDoneAck(totalBytes, totalChunks));
    },
    verifyDoneAckMac(macB64: string, totalBytes: number, totalChunks: number): boolean {
      try {
        const candidate = base64UrlToBytes(macB64);
        const expected = computeExpectedDoneAck(totalBytes, totalChunks);
        const ok = constantTimeEqual(candidate, expected);
        wipeBytes(expected);
        return ok;
      } catch {
        return false;
      }
    },
    sealS2RFrame(kind: number, seq: number, plaintext: Uint8Array): Uint8Array {
      if (plaintext.length > DROP_CHUNK_PLAINTEXT_BYTES) {
        throw new Error('Chunk plaintext exceeds 64 KiB wire frame cap');
      }
      const header = new Uint8Array(DROP_HEADER_BYTES);
      header[0] = kind & 0xff;
      writeSeqBE64(header, 1, seq);

      const nonce = new Uint8Array(12);
      nonce.set(s2rNoncePrefix, 0);
      writeSeqBE64(nonce, 4, seq);

      const sealed = chacha20Poly1305Seal(s2rKey, nonce, plaintext, header);
      const wire = new Uint8Array(DROP_HEADER_BYTES + sealed.length);
      wire.set(header, 0);
      wire.set(sealed, DROP_HEADER_BYTES);
      return wire;
    },
    openS2RFrame(
      frame: Uint8Array,
      expectedSeq: number
    ): { kind: number; plaintext: Uint8Array } {
      if (
        frame.length < DROP_HEADER_BYTES + DROP_TAG_BYTES ||
        frame.length > DROP_MAX_WIRE_FRAME_BYTES
      ) {
        throw new Error('Invalid encrypted frame length');
      }
      const kind = frame[0];
      const seq = readSeqBE64(frame, 1);
      if (seq !== expectedSeq) {
        throw new Error(`Out-of-order or replayed frame (expected ${expectedSeq}, got ${seq})`);
      }

      const header = frame.subarray(0, DROP_HEADER_BYTES);
      const nonce = new Uint8Array(12);
      nonce.set(s2rNoncePrefix, 0);
      writeSeqBE64(nonce, 4, seq);

      const plaintext = chacha20Poly1305Open(
        s2rKey,
        nonce,
        frame.subarray(DROP_HEADER_BYTES),
        header
      );
      return { kind, plaintext };
    },
    destroy(): void {
      wipeBytes(s2rKey);
      wipeBytes(s2rNoncePrefix);
      wipeBytes(myMac);
      wipeBytes(expectedPeerMac);
      wipeBytes(ackKey);
      wipeBytes(transcript);
    },
  };
}

export function encodeDropMeta(meta: DropTransferMeta): Uint8Array {
  const safe: DropTransferMeta = {
    kind: meta.kind === 'file' ? 'file' : 'text',
    ...(meta.fileName ? { fileName: sanitizeTransferFileName(meta.fileName) } : {}),
    mimeType: (meta.mimeType || 'application/octet-stream').slice(0, 120),
    totalBytes: Math.max(0, Math.floor(meta.totalBytes)),
    totalChunks: Math.max(0, Math.floor(meta.totalChunks)),
  };
  return new TextEncoder().encode(JSON.stringify(safe));
}

export function decodeDropMeta(bytes: Uint8Array): DropTransferMeta {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DropTransferMeta>;
  if (
    (parsed.kind !== 'text' && parsed.kind !== 'file') ||
    typeof parsed.totalBytes !== 'number' ||
    !Number.isFinite(parsed.totalBytes) ||
    parsed.totalBytes < 0 ||
    typeof parsed.totalChunks !== 'number' ||
    !Number.isFinite(parsed.totalChunks) ||
    parsed.totalChunks < 0
  ) {
    throw new Error('Malformed encrypted transfer metadata');
  }
  return {
    kind: parsed.kind,
    fileName: parsed.kind === 'file' ? sanitizeTransferFileName(parsed.fileName) : undefined,
    mimeType:
      typeof parsed.mimeType === 'string' && parsed.mimeType
        ? parsed.mimeType.slice(0, 120)
        : 'application/octet-stream',
    totalBytes: Math.floor(parsed.totalBytes),
    totalChunks: Math.floor(parsed.totalChunks),
  };
}

export function encodeDropEof(eof: DropTransferEof): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      totalBytes: Math.max(0, Math.floor(eof.totalBytes)),
      totalChunks: Math.max(0, Math.floor(eof.totalChunks)),
    })
  );
}

export function decodeDropEof(bytes: Uint8Array): DropTransferEof {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DropTransferEof>;
  if (
    typeof parsed.totalBytes !== 'number' ||
    typeof parsed.totalChunks !== 'number' ||
    parsed.totalBytes < 0 ||
    parsed.totalChunks < 0
  ) {
    throw new Error('Malformed encrypted EOF frame');
  }
  return {
    totalBytes: Math.floor(parsed.totalBytes),
    totalChunks: Math.floor(parsed.totalChunks),
  };
}
