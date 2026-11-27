// Dual-transport `/drop` session engine:
// 1. WebSocket signaling + X25519 + 6-digit PIN HKDF + mutual Key Confirmation MAC (verified before sending metadata).
// 2. Primary WebRTC `RTCDataChannel` (`iceServers: []` -> strictly zero external STUN/TURN calls).
// 3. Automatic 3-second fallback to `/api/drop/ws` encrypted binary chunk streaming with `bufferedAmount` backpressure.

import { fetchAppMeta } from '../../lib/api';
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
  encodeDropEof,
  encodeDropMeta,
  type DropCryptoSession,
  type DropTransferMeta,
} from './protocol';

export type DropTransportMode = 'pending' | 'p2p' | 'relay';

export type DropErrorCode =
  | 'expired'
  | 'invalid_or_expired'
  | 'rooms_full'
  | 'rate_limited'
  | 'mac_mismatch'
  | 'relay_limit_exceeded'
  | 'payload_too_large'
  | 'peer_disconnected'
  | 'aborted'
  | 'unauthorized'
  | 'network_error';

export type DropSendPhase =
  | 'connecting'
  | 'waiting'
  | 'verifying'
  | 'negotiating'
  | 'streaming'
  | 'completed'
  | 'error';

export type DropReceivePhase =
  | 'connecting'
  | 'verifying'
  | 'negotiating'
  | 'receiving'
  | 'completed'
  | 'error';

export type OutgoingDropPayload =
  | { kind: 'text'; text: string }
  | { kind: 'file'; blob: Blob; fileName: string; mimeType: string };

export interface ReceivedDropResult {
  kind: 'text' | 'file';
  text?: string;
  fileName?: string;
  mimeType: string;
  totalBytes: number;
  blob?: Blob;
}

export interface SendSessionCallbacks {
  onPhaseChange: (phase: DropSendPhase) => void;
  onCodeIssued: (code: string, ttlSeconds: number, maxRelayMb: number) => void;
  onTransportSelected: (mode: 'p2p' | 'relay', fingerprint: string) => void;
  onProgress: (sentBytes: number, totalBytes: number) => void;
  onError: (code: DropErrorCode) => void;
  onUnauthorized?: () => void;
}

export interface ReceiveSessionCallbacks {
  onPhaseChange: (phase: DropReceivePhase) => void;
  onTransportSelected: (mode: 'p2p' | 'relay', fingerprint: string) => void;
  onMeta: (meta: DropTransferMeta) => void;
  onProgress: (receivedBytes: number, totalBytes: number) => void;
  onComplete: (result: ReceivedDropResult) => void;
  onError: (code: DropErrorCode) => void;
  onUnauthorized?: () => void;
}

export interface DropSessionHandle {
  cancel: () => void;
}

const P2P_CONNECT_TIMEOUT_MS = 3000;
const DC_BUFFER_HIGH_WATER = 512 * 1024;
const DC_BUFFER_LOW_WATER = 128 * 1024;
const WS_BUFFER_HIGH_WATER = 512 * 1024;
/** Maximum in-browser receive size (512 MiB for P2P files; 16 MiB for UTF-8 text) so mobile tabs never OOM. */
export const DROP_MAX_P2P_FILE_BYTES = 512 * 1024 * 1024;
export const DROP_MAX_TEXT_BYTES = 16 * 1024 * 1024;
/** Flush decrypted file chunks into a Blob segment every 64 chunks (~4 MiB) to release JS Uint8Array heap early. */
const CHUNKS_PER_BLOB_SEGMENT = 64;

function buildDropWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/drop/ws`;
}

function mapServerErrorCode(raw: unknown): DropErrorCode {
  switch (raw) {
    case 'expired':
      return 'expired';
    case 'invalid_or_expired':
      return 'invalid_or_expired';
    case 'rooms_full':
      return 'rooms_full';
    case 'rate_limited':
      return 'rate_limited';
    case 'relay_limit_exceeded':
      return 'relay_limit_exceeded';
    case 'aborted':
      return 'aborted';
    default:
      return 'network_error';
  }
}

async function waitForWsDrain(ws: WebSocket, isCancelled: () => boolean): Promise<void> {
  while (!isCancelled() && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > WS_BUFFER_HIGH_WATER) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 12));
  }
}

async function waitForDcDrain(dc: RTCDataChannel, isCancelled: () => boolean): Promise<void> {
  if (dc.bufferedAmount <= DC_BUFFER_HIGH_WATER) return;
  dc.bufferedAmountLowThreshold = DC_BUFFER_LOW_WATER;
  await new Promise<void>((resolve) => {
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      dc.removeEventListener('bufferedamountlow', done);
      dc.removeEventListener('close', done);
      resolve();
    };
    dc.addEventListener('bufferedamountlow', done);
    dc.addEventListener('close', done);
    timer = window.setTimeout(done, 40);
    if (isCancelled() || dc.bufferedAmount <= DC_BUFFER_HIGH_WATER) {
      done();
    }
  });
}

async function checkIfUnauthorized(onUnauthorized?: () => void): Promise<boolean> {
  try {
    const meta = await fetchAppMeta();
    if (meta.auth.enabled && !meta.auth.authenticated) {
      onUnauthorized?.();
      return true;
    }
  } catch {
    // Ignore offline probe error
  }
  return false;
}

function isForceRelayActive(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { __pikbayForceDropRelay?: boolean };
  return Boolean(win.__pikbayForceDropRelay);
}

export function startDropSendSession(
  payload: OutgoingDropPayload,
  cb: SendSessionCallbacks
): DropSessionHandle {
  const identity = createEphemeralDropIdentity();
  let cryptoSession: DropCryptoSession | null = null;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let fallbackTimer = 0;
  let finished = false;
  let cancelled = false;
  let issuedCode = '';
  let maxRelayMb = 256;
  let transportChosen: 'p2p' | 'relay' | null = null;
  let peerConfirmed = false;
  let expectedDoneAck: { totalBytes: number; totalChunks: number } | null = null;
  let doneResolver: (() => void) | null = null;
  let doneRejecter: ((err: Error) => void) | null = null;
  const pendingIce: RTCIceCandidateInit[] = [];

  const cleanup = (sendAbort = false) => {
    window.clearTimeout(fallbackTimer);
    if (sendAbort && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'abort' }));
      } catch {
        // Ignore socket teardown error
      }
    }
    if (dc) {
      try {
        dc.close();
      } catch {
        // Ignore
      }
      dc = null;
    }
    if (pc) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
      pc = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // Ignore
      }
      ws = null;
    }
    cryptoSession?.destroy();
    cryptoSession = null;
    wipeBytes(identity.privateKey);
  };

  const fail = (code: DropErrorCode, sendAbort = false) => {
    if (finished || cancelled) return;
    finished = true;
    cleanup(sendAbort);
    cb.onPhaseChange('error');
    cb.onError(code);
  };

  const sendSignal = (obj: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  const handleDoneAckMessage = (rawMac: unknown) => {
    if (!cryptoSession || !expectedDoneAck) return;
    const mac = typeof rawMac === 'string' ? rawMac : '';
    if (
      cryptoSession.verifyDoneAckMac(
        mac,
        expectedDoneAck.totalBytes,
        expectedDoneAck.totalChunks
      )
    ) {
      doneResolver?.();
    } else {
      doneRejecter?.(new Error('Invalid done acknowledgment MAC'));
      fail('mac_mismatch', true);
    }
  };

  const streamPayloadOver = async (mode: 'p2p' | 'relay') => {
    if (finished || cancelled || !cryptoSession || transportChosen) return;
    transportChosen = mode;
    window.clearTimeout(fallbackTimer);

    if (mode === 'relay') {
      if (pc) {
        try {
          pc.close();
        } catch {
          // Ignore
        }
        pc = null;
      }
      sendSignal({ type: 'transport_mode', mode: 'relay' });
    } else {
      sendSignal({ type: 'transport_mode', mode: 'p2p' });
    }

    cb.onTransportSelected(mode, cryptoSession.fingerprint);
    cb.onPhaseChange('streaming');

    try {
      const textBytes =
        payload.kind === 'text' ? new TextEncoder().encode(payload.text) : null;
      const totalBytes =
        payload.kind === 'text' ? textBytes!.byteLength : payload.blob.size;

      if (
        (payload.kind === 'text' && totalBytes > DROP_MAX_TEXT_BYTES) ||
        totalBytes > DROP_MAX_P2P_FILE_BYTES
      ) {
        if (textBytes) wipeBytes(textBytes);
        fail('payload_too_large', true);
        return;
      }

      if (mode === 'relay' && totalBytes > maxRelayMb * 1024 * 1024) {
        if (textBytes) wipeBytes(textBytes);
        fail('relay_limit_exceeded', true);
        return;
      }

      const totalChunks =
        totalBytes === 0 ? 0 : Math.ceil(totalBytes / DROP_CHUNK_PLAINTEXT_BYTES);
      expectedDoneAck = { totalBytes, totalChunks };

      const sendFrame = async (wire: Uint8Array) => {
        if (cancelled || finished) return;
        const buf = new Uint8Array(wire.byteLength);
        buf.set(wire);
        if (mode === 'p2p' && dc && dc.readyState === 'open') {
          await waitForDcDrain(dc, () => cancelled || finished);
          dc.send(buf);
        } else if (ws && ws.readyState === WebSocket.OPEN) {
          await waitForWsDrain(ws, () => cancelled || finished);
          ws.send(buf);
        } else {
          throw new Error('Transport closed');
        }
      };

      const doneAckPromise = new Promise<void>((resolve, reject) => {
        doneResolver = resolve;
        doneRejecter = reject;
      });

      // 1. Encrypted META frame (`seq = 0`)
      await sendFrame(
        cryptoSession.sealS2RFrame(
          DROP_FRAME_META,
          0,
          encodeDropMeta({
            kind: payload.kind,
            fileName: payload.kind === 'file' ? payload.fileName : undefined,
            mimeType:
              payload.kind === 'file'
                ? payload.mimeType || 'application/octet-stream'
                : 'text/plain;charset=utf-8',
            totalBytes,
            totalChunks,
          })
        )
      );

      cb.onProgress(0, totalBytes);

      // 2. Encrypted CHUNK frames (`seq = 1..totalChunks`)
      let sentBytes = 0;
      for (let idx = 0; idx < totalChunks; idx += 1) {
        if (cancelled || finished) return;
        const start = idx * DROP_CHUNK_PLAINTEXT_BYTES;
        const end = Math.min(totalBytes, start + DROP_CHUNK_PLAINTEXT_BYTES);
        let chunkBytes: Uint8Array;
        if (payload.kind === 'text') {
          chunkBytes = textBytes!.subarray(start, end);
        } else {
          const ab = await payload.blob.slice(start, end).arrayBuffer();
          chunkBytes = new Uint8Array(ab);
        }

        const wire = cryptoSession.sealS2RFrame(DROP_FRAME_CHUNK, idx + 1, chunkBytes);
        await sendFrame(wire);
        sentBytes += chunkBytes.byteLength;
        cb.onProgress(sentBytes, totalBytes);
      }

      if (textBytes) wipeBytes(textBytes);

      // 3. Explicit authenticated EOF frame (`seq = totalChunks + 1`)
      await sendFrame(
        cryptoSession.sealS2RFrame(
          DROP_FRAME_EOF,
          totalChunks + 1,
          encodeDropEof({ totalBytes, totalChunks })
        )
      );

      // Wait for receiver's authenticated `done` acknowledgment before closing sockets
      await Promise.race([
        doneAckPromise,
        new Promise<void>((_, reject) =>
          window.setTimeout(() => reject(new Error('Ack timeout')), 15_000)
        ),
      ]);

      if (!cancelled && !finished) {
        finished = true;
        cb.onPhaseChange('completed');
        cleanup(false);
      }
    } catch {
      fail('peer_disconnected', false);
    }
  };

  const beginTransportNegotiation = async () => {
    if (finished || cancelled) return;
    cb.onPhaseChange('negotiating');

    if (typeof RTCPeerConnection === 'undefined' || isForceRelayActive()) {
      void streamPayloadOver('relay');
      return;
    }

    fallbackTimer = window.setTimeout(() => {
      if (!transportChosen && !finished && !cancelled) {
        void streamPayloadOver('relay');
      }
    }, P2P_CONNECT_TIMEOUT_MS);

    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      dc = pc.createDataChannel('pikbay-drop', { ordered: true });
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        if (!transportChosen && !finished && !cancelled) {
          void streamPayloadOver('p2p');
        }
      };

      dc.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const parsed = JSON.parse(ev.data) as { type?: string; mac?: string };
            if (parsed.type === 'done') handleDoneAckMessage(parsed.mac);
          } catch {
            // Ignore
          }
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal({ type: 'rtc_ice', candidate: ev.candidate.toJSON() });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'rtc_offer', sdp: pc.localDescription });
    } catch {
      void streamPayloadOver('relay');
    }
  };

  cb.onPhaseChange('connecting');
  let opened = false;
  ws = new WebSocket(buildDropWsUrl());
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    opened = true;
    sendSignal({
      type: 'create',
      pubKey: identity.pubKeyB64,
      salt: identity.saltB64,
    });
  };

  ws.onmessage = async (ev) => {
    if (finished || cancelled || typeof ev.data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      fail('network_error', true);
      return;
    }

    switch (msg.type) {
      case 'created': {
        issuedCode = String(msg.code ?? '');
        const ttl = Number(msg.ttlSeconds ?? 180);
        maxRelayMb = Number(msg.maxRelayMb ?? 256);
        cb.onCodeIssued(issuedCode, ttl, maxRelayMb);
        cb.onPhaseChange('waiting');
        break;
      }
      case 'peer_joined': {
        cb.onPhaseChange('verifying');
        try {
          cryptoSession = deriveDropCryptoSession({
            role: 'sender',
            code: issuedCode,
            myPrivateKey: identity.privateKey,
            peerPubKeyB64: String(msg.pubKey ?? ''),
            senderPubKeyB64: identity.pubKeyB64,
            receiverPubKeyB64: String(msg.pubKey ?? ''),
            senderSaltB64: identity.saltB64,
            receiverSaltB64: String(msg.salt ?? ''),
          });
          wipeBytes(identity.privateKey);
          sendSignal({
            type: 'key_confirm',
            mac: cryptoSession.myConfirmMacB64,
          });
        } catch {
          fail('mac_mismatch', true);
        }
        break;
      }
      case 'key_confirm': {
        if (!cryptoSession || !cryptoSession.verifyPeerConfirmMac(String(msg.mac ?? ''))) {
          fail('mac_mismatch', true);
          return;
        }
        peerConfirmed = true;
        await beginTransportNegotiation();
        break;
      }
      case 'rtc_answer': {
        if (pc && peerConfirmed && !transportChosen && msg.sdp) {
          try {
            await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
            for (const cand of pendingIce.splice(0)) {
              await pc.addIceCandidate(cand);
            }
          } catch {
            void streamPayloadOver('relay');
          }
        }
        break;
      }
      case 'rtc_ice': {
        if (pc && peerConfirmed && !transportChosen && msg.candidate) {
          const cand = msg.candidate as RTCIceCandidateInit;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(cand);
            } catch {
              // Ignore non-fatal local ICE candidate mismatch
            }
          } else {
            pendingIce.push(cand);
          }
        }
        break;
      }
      case 'done': {
        handleDoneAckMessage(msg.mac);
        break;
      }
      case 'peer_disconnected': {
        if (!finished) fail('peer_disconnected', false);
        break;
      }
      case 'error': {
        fail(mapServerErrorCode(msg.code), false);
        break;
      }
    }
  };

  ws.onerror = () => {
    if (!opened && !finished && !cancelled) {
      void checkIfUnauthorized(cb.onUnauthorized).then((unauth) => {
        fail(unauth ? 'unauthorized' : 'network_error', false);
      });
    }
  };

  ws.onclose = () => {
    if (!finished && !cancelled) {
      if (!opened) {
        void checkIfUnauthorized(cb.onUnauthorized).then((unauth) => {
          fail(unauth ? 'unauthorized' : 'network_error', false);
        });
      } else {
        fail('peer_disconnected', false);
      }
    }
  };

  return {
    cancel() {
      if (cancelled || finished) return;
      cancelled = true;
      cleanup(true);
    },
  };
}

export function startDropReceiveSession(
  code: string,
  cb: ReceiveSessionCallbacks
): DropSessionHandle {
  const identity = createEphemeralDropIdentity();
  let cryptoSession: DropCryptoSession | null = null;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let finished = false;
  let cancelled = false;
  let peerConfirmed = false;
  let expectedSeq = 0;
  let receivedBytes = 0;
  let receivedChunkCount = 0;
  let activeMeta: DropTransferMeta | null = null;
  const collectedChunks: Uint8Array[] = [];
  const blobSegments: Blob[] = [];
  const pendingIce: RTCIceCandidateInit[] = [];
  let announcedTransport = false;

  const flushFileChunksToBlobSegment = () => {
    if (collectedChunks.length === 0) return;
    blobSegments.push(new Blob(collectedChunks as BlobPart[], { type: 'application/octet-stream' }));
    for (const chunk of collectedChunks) wipeBytes(chunk);
    collectedChunks.length = 0;
  };

  const wipeCollected = () => {
    for (const chunk of collectedChunks) wipeBytes(chunk);
    collectedChunks.length = 0;
    blobSegments.length = 0;
  };

  const cleanup = (sendAbort = false) => {
    if (sendAbort && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'abort' }));
      } catch {
        // Ignore
      }
    }
    if (dc) {
      try {
        dc.close();
      } catch {
        // Ignore
      }
      dc = null;
    }
    if (pc) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
      pc = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // Ignore
      }
      ws = null;
    }
    cryptoSession?.destroy();
    cryptoSession = null;
    wipeBytes(identity.privateKey);
  };

  const fail = (errCode: DropErrorCode, sendAbort = false) => {
    if (finished || cancelled) return;
    finished = true;
    wipeCollected();
    cleanup(sendAbort);
    cb.onPhaseChange('error');
    cb.onError(errCode);
  };

  const sendSignal = (obj: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  const handleEncryptedBinaryFrame = (rawBuf: ArrayBuffer, source: 'p2p' | 'relay') => {
    if (finished || cancelled || !cryptoSession || !peerConfirmed) {
      fail('mac_mismatch', true);
      return;
    }
    if (!announcedTransport) {
      announcedTransport = true;
      cb.onTransportSelected(source, cryptoSession.fingerprint);
    }

    try {
      const opened = cryptoSession.openS2RFrame(new Uint8Array(rawBuf), expectedSeq);
      expectedSeq += 1;

      if (opened.kind === DROP_FRAME_META) {
        if (expectedSeq !== 1 || activeMeta !== null) {
          throw new Error('Unexpected duplicate META frame');
        }
        const meta = decodeDropMeta(opened.plaintext);
        if (
          (meta.kind === 'text' && meta.totalBytes > DROP_MAX_TEXT_BYTES) ||
          meta.totalBytes > DROP_MAX_P2P_FILE_BYTES
        ) {
          fail('payload_too_large', true);
          return;
        }
        activeMeta = meta;
        cb.onMeta(activeMeta);
        cb.onPhaseChange('receiving');
        cb.onProgress(0, activeMeta.totalBytes);
      } else if (opened.kind === DROP_FRAME_CHUNK) {
        if (!activeMeta) throw new Error('Chunk arrived before META');
        receivedBytes += opened.plaintext.byteLength;
        receivedChunkCount += 1;
        if (receivedBytes > activeMeta.totalBytes || receivedChunkCount > activeMeta.totalChunks) {
          throw new Error('Received bytes exceeded declared totalBytes');
        }
        collectedChunks.push(opened.plaintext);
        if (activeMeta.kind === 'file' && collectedChunks.length >= CHUNKS_PER_BLOB_SEGMENT) {
          flushFileChunksToBlobSegment();
        }
        cb.onProgress(receivedBytes, activeMeta.totalBytes);
      } else if (opened.kind === DROP_FRAME_EOF) {
        if (!activeMeta) throw new Error('EOF arrived before META');
        const eof = decodeDropEof(opened.plaintext);
        if (
          eof.totalBytes !== activeMeta.totalBytes ||
          receivedBytes !== activeMeta.totalBytes ||
          receivedChunkCount !== activeMeta.totalChunks ||
          eof.totalChunks !== activeMeta.totalChunks
        ) {
          throw new Error('Truncated or mismatched EOF byte count');
        }

        const ackMac = cryptoSession.computeDoneAckMac(
          activeMeta.totalBytes,
          activeMeta.totalChunks
        );
        // Acknowledge verified delivery to sender over both DC and WS before tearing down
        if (dc && dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify({ type: 'done', mac: ackMac }));
          } catch {
            // Ignore
          }
        }
        sendSignal({ type: 'done', mac: ackMac });

        let decodedText: string | undefined;
        let finalFileBlob: Blob | undefined;
        if (activeMeta.kind === 'text') {
          const merged = new Uint8Array(activeMeta.totalBytes);
          let off = 0;
          for (const c of collectedChunks) {
            merged.set(c, off);
            off += c.byteLength;
            wipeBytes(c);
          }
          collectedChunks.length = 0;
          decodedText = new TextDecoder().decode(merged);
          wipeBytes(merged);
        } else {
          flushFileChunksToBlobSegment();
          finalFileBlob = new Blob(blobSegments, { type: 'application/octet-stream' });
          blobSegments.length = 0;
        }

        finished = true;
        cb.onPhaseChange('completed');
        cb.onComplete({
          kind: activeMeta.kind,
          text: decodedText,
          fileName: activeMeta.fileName,
          mimeType: activeMeta.mimeType,
          totalBytes: activeMeta.totalBytes,
          blob: finalFileBlob,
        });
        // Allow the authenticated `done` frame to flush before closing
        window.setTimeout(() => cleanup(false), 60);
      } else {
        throw new Error('Unknown AEAD frame kind');
      }
    } catch {
      fail('mac_mismatch', true);
    }
  };

  cb.onPhaseChange('connecting');
  let opened = false;
  ws = new WebSocket(buildDropWsUrl());
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    opened = true;
    sendSignal({
      type: 'join',
      code,
      pubKey: identity.pubKeyB64,
      salt: identity.saltB64,
    });
  };

  ws.onmessage = async (ev) => {
    if (finished || cancelled) return;

    if (ev.data instanceof ArrayBuffer) {
      handleEncryptedBinaryFrame(ev.data, 'relay');
      return;
    }

    if (typeof ev.data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      fail('network_error', true);
      return;
    }

    switch (msg.type) {
      case 'joined': {
        cb.onPhaseChange('verifying');
        try {
          cryptoSession = deriveDropCryptoSession({
            role: 'receiver',
            code,
            myPrivateKey: identity.privateKey,
            peerPubKeyB64: String(msg.pubKey ?? ''),
            senderPubKeyB64: String(msg.pubKey ?? ''),
            receiverPubKeyB64: identity.pubKeyB64,
            senderSaltB64: String(msg.salt ?? ''),
            receiverSaltB64: identity.saltB64,
          });
          wipeBytes(identity.privateKey);
          sendSignal({
            type: 'key_confirm',
            mac: cryptoSession.myConfirmMacB64,
          });
        } catch {
          fail('mac_mismatch', true);
        }
        break;
      }
      case 'key_confirm': {
        if (!cryptoSession || !cryptoSession.verifyPeerConfirmMac(String(msg.mac ?? ''))) {
          fail('mac_mismatch', true);
          return;
        }
        peerConfirmed = true;
        cb.onPhaseChange('negotiating');
        break;
      }
      case 'transport_mode': {
        if (!announcedTransport && cryptoSession) {
          const mode = msg.mode === 'p2p' ? 'p2p' : 'relay';
          announcedTransport = true;
          cb.onTransportSelected(mode, cryptoSession.fingerprint);
        }
        break;
      }
      case 'rtc_offer': {
        if (!peerConfirmed || typeof RTCPeerConnection === 'undefined' || isForceRelayActive()) {
          break;
        }
        try {
          pc = new RTCPeerConnection({ iceServers: [] });
          pc.ondatachannel = (dcEv) => {
            dc = dcEv.channel;
            dc.binaryType = 'arraybuffer';
            dc.onmessage = (mEv) => {
              if (mEv.data instanceof ArrayBuffer) {
                handleEncryptedBinaryFrame(mEv.data, 'p2p');
              }
            };
          };
          pc.onicecandidate = (iceEv) => {
            if (iceEv.candidate) {
              sendSignal({ type: 'rtc_ice', candidate: iceEv.candidate.toJSON() });
            }
          };
          await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
          for (const cand of pendingIce.splice(0)) {
            await pc.addIceCandidate(cand);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: 'rtc_answer', sdp: pc.localDescription });
        } catch {
          // Sender's 3-second P2P timeout will seamlessly fall back to WS ciphertext relay
        }
        break;
      }
      case 'rtc_ice': {
        if (pc && peerConfirmed && msg.candidate) {
          const cand = msg.candidate as RTCIceCandidateInit;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(cand);
            } catch {
              // Ignore non-fatal candidate failure
            }
          } else {
            pendingIce.push(cand);
          }
        }
        break;
      }
      case 'peer_disconnected': {
        if (!finished) fail('peer_disconnected', false);
        break;
      }
      case 'error': {
        fail(mapServerErrorCode(msg.code), false);
        break;
      }
    }
  };

  ws.onerror = () => {
    if (!opened && !finished && !cancelled) {
      void checkIfUnauthorized(cb.onUnauthorized).then((unauth) => {
        fail(unauth ? 'unauthorized' : 'network_error', false);
      });
    }
  };

  ws.onclose = () => {
    if (!finished && !cancelled) {
      if (!opened) {
        void checkIfUnauthorized(cb.onUnauthorized).then((unauth) => {
          fail(unauth ? 'unauthorized' : 'network_error', false);
        });
      } else {
        fail('peer_disconnected', false);
      }
    }
  };

  return {
    cancel() {
      if (cancelled || finished) return;
      cancelled = true;
      wipeCollected();
      cleanup(true);
    },
  };
}
