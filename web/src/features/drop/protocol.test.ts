import { describe, expect, it } from 'vitest';
import { wipeBytes } from '../../lib/crypto';
import {
  createEphemeralDropIdentity,
  decodeDropEof,
  decodeDropMeta,
  deriveDropCryptoSession,
  DROP_CHUNK_PLAINTEXT_BYTES,
  DROP_FRAME_CHUNK,
  DROP_FRAME_EOF,
  DROP_FRAME_META,
  DROP_MAX_WIRE_FRAME_BYTES,
  encodeDropEof,
  encodeDropMeta,
  formatSixDigitCode,
  normalizeSixDigitCode,
  sanitizeTransferFileName,
} from './protocol';

describe('/drop end-to-end cryptographic protocol (X25519 + PIN HKDF + mutual MAC + chunked AEAD)', () => {
  it('completes mutual key confirmation and multi-chunk 64 KiB AEAD streaming when 6-digit codes match', () => {
    const senderId = createEphemeralDropIdentity();
    const receiverId = createEphemeralDropIdentity();
    const pin = '482910';

    const senderSession = deriveDropCryptoSession({
      role: 'sender',
      code: pin,
      myPrivateKey: senderId.privateKey,
      peerPubKeyB64: receiverId.pubKeyB64,
      senderPubKeyB64: senderId.pubKeyB64,
      receiverPubKeyB64: receiverId.pubKeyB64,
      senderSaltB64: senderId.saltB64,
      receiverSaltB64: receiverId.saltB64,
    });

    const receiverSession = deriveDropCryptoSession({
      role: 'receiver',
      code: pin,
      myPrivateKey: receiverId.privateKey,
      peerPubKeyB64: senderId.pubKeyB64,
      senderPubKeyB64: senderId.pubKeyB64,
      receiverPubKeyB64: receiverId.pubKeyB64,
      senderSaltB64: senderId.saltB64,
      receiverSaltB64: receiverId.saltB64,
    });

    expect(senderSession.fingerprint).toBe(receiverSession.fingerprint);
    expect(senderSession.verifyPeerConfirmMac(receiverSession.myConfirmMacB64)).toBe(true);
    expect(receiverSession.verifyPeerConfirmMac(senderSession.myConfirmMacB64)).toBe(true);

    // Build a 140 KiB binary payload spanning 3 chunks
    const payload = new Uint8Array(140 * 1024);
    for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 37 + 11) & 0xff;
    const totalChunks = Math.ceil(payload.length / DROP_CHUNK_PLAINTEXT_BYTES);

    const frames: Uint8Array[] = [];
    frames.push(
      senderSession.sealS2RFrame(
        DROP_FRAME_META,
        0,
        encodeDropMeta({
          kind: 'file',
          fileName: '../../secret-archive.tar.zst',
          mimeType: 'application/zstd',
          totalBytes: payload.length,
          totalChunks,
        })
      )
    );

    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * DROP_CHUNK_PLAINTEXT_BYTES;
      const slice = payload.subarray(start, start + DROP_CHUNK_PLAINTEXT_BYTES);
      const wire = senderSession.sealS2RFrame(DROP_FRAME_CHUNK, idx + 1, slice);
      expect(wire.byteLength).toBeLessThanOrEqual(DROP_MAX_WIRE_FRAME_BYTES);
      frames.push(wire);
    }

    frames.push(
      senderSession.sealS2RFrame(
        DROP_FRAME_EOF,
        totalChunks + 1,
        encodeDropEof({ totalBytes: payload.length, totalChunks })
      )
    );

    // Receiver opens in strict monotonic order
    const openedMeta = receiverSession.openS2RFrame(frames[0], 0);
    expect(openedMeta.kind).toBe(DROP_FRAME_META);
    const meta = decodeDropMeta(openedMeta.plaintext);
    expect(meta.fileName).toBe('secret-archive.tar.zst');
    expect(meta.totalBytes).toBe(payload.length);

    const reassembled = new Uint8Array(meta.totalBytes);
    let writeOff = 0;
    for (let seq = 1; seq <= totalChunks; seq += 1) {
      const chunkFrame = receiverSession.openS2RFrame(frames[seq], seq);
      expect(chunkFrame.kind).toBe(DROP_FRAME_CHUNK);
      reassembled.set(chunkFrame.plaintext, writeOff);
      writeOff += chunkFrame.plaintext.length;
    }

    const openedEof = receiverSession.openS2RFrame(frames[totalChunks + 1], totalChunks + 1);
    expect(openedEof.kind).toBe(DROP_FRAME_EOF);
    expect(decodeDropEof(openedEof.plaintext)).toEqual({
      totalBytes: payload.length,
      totalChunks,
    });
    expect(reassembled).toEqual(payload);

    // Authenticated `done` receipt MAC binds exact totalBytes & totalChunks
    const validDoneMac = receiverSession.computeDoneAckMac(payload.length, totalChunks);
    expect(senderSession.verifyDoneAckMac(validDoneMac, payload.length, totalChunks)).toBe(true);
    expect(senderSession.verifyDoneAckMac(validDoneMac, payload.length - 1, totalChunks)).toBe(
      false
    );
    expect(senderSession.verifyDoneAckMac('forged-mac', payload.length, totalChunks)).toBe(false);

    // Out-of-order / replayed sequence numbers must be rejected
    expect(() => receiverSession.openS2RFrame(frames[1], 2)).toThrow();

    senderSession.destroy();
    receiverSession.destroy();
    wipeBytes(senderId.privateKey);
    wipeBytes(receiverId.privateKey);
  });

  it('rejects mutual MAC immediately when 6-digit PIN differs by a single digit', () => {
    const senderId = createEphemeralDropIdentity();
    const receiverId = createEphemeralDropIdentity();

    const senderSession = deriveDropCryptoSession({
      role: 'sender',
      code: '739204',
      myPrivateKey: senderId.privateKey,
      peerPubKeyB64: receiverId.pubKeyB64,
      senderPubKeyB64: senderId.pubKeyB64,
      receiverPubKeyB64: receiverId.pubKeyB64,
      senderSaltB64: senderId.saltB64,
      receiverSaltB64: receiverId.saltB64,
    });

    const wrongPinReceiver = deriveDropCryptoSession({
      role: 'receiver',
      code: '739205',
      myPrivateKey: receiverId.privateKey,
      peerPubKeyB64: senderId.pubKeyB64,
      senderPubKeyB64: senderId.pubKeyB64,
      receiverPubKeyB64: receiverId.pubKeyB64,
      senderSaltB64: senderId.saltB64,
      receiverSaltB64: receiverId.saltB64,
    });

    expect(senderSession.verifyPeerConfirmMac(wrongPinReceiver.myConfirmMacB64)).toBe(false);
    expect(wrongPinReceiver.verifyPeerConfirmMac(senderSession.myConfirmMacB64)).toBe(false);
  });

  it('normalizes 6-digit codes and strips path traversal from filenames', () => {
    expect(normalizeSixDigitCode(' 482 - 91099 ')).toBe('482910');
    expect(formatSixDigitCode('482910')).toBe('482 910');
    expect(sanitizeTransferFileName('..\\..\\etc\\shadow')).toBe('shadow');
    expect(sanitizeTransferFileName('...')).toBe('drop-payload.bin');
  });
});
