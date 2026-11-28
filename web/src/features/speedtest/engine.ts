// Browser parallel speedtest engine:
// - 20 sequential pings (cold-start sample discarded; median RTT + mean consecutive jitter)
// - Up to 6 parallel download streams (`ReadableStream` byte counting, adaptive chunk sizing)
// - Up to 4 parallel upload streams (`POST /api/speed/up` server-confirmed byte counting starting at 128 KiB,
//   eliminating false 0 Mbps readings caused by local OS/proxy socket buffering on port-forwarded links)
// - 100ms oscilloscope ticks (~300ms sliding instantaneous window), 2s warmup window, checkpoint-based sustained throughput; aborts immediately on HTTP 429.

import {
  computePingAndJitter,
  computeSustainedThroughputMbps,
  computeTailUploadChunkBytes,
  nextAdaptiveChunkBytes,
  type ByteCheckpoint,
} from './math';

export type SpeedtestPhase = 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'aborted' | 'error';

export type SpeedtestErrorKind = 'rate_limited' | 'unauthorized' | 'network';

export interface SpeedtestProgress {
  phase: SpeedtestPhase;
  pingMs: number | null;
  jitterMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  rxSeries: number[];
  txSeries: number[];
}

export interface SpeedtestOptions {
  pingCount?: number;
  pingTimeoutMs?: number;
  parallelStreams?: number;
  maxDownloadMb?: number;
  maxUploadMb?: number;
  requestsPerMinute?: number;
  phaseDurationMs?: number;
  warmupMs?: number;
  sampleIntervalMs?: number;
  onProgress: (snapshot: SpeedtestProgress) => void;
}

export class SpeedtestRunError extends Error {
  readonly kind: SpeedtestErrorKind;

  constructor(kind: SpeedtestErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const KIB = 1024;
const MIB = 1024 * 1024;
const MAX_CRYPTO_SLICE = 65536;

function createRandomOneMiBChunk(): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(MIB));
  for (let offset = 0; offset < buf.byteLength; offset += MAX_CRYPTO_SLICE) {
    const end = Math.min(offset + MAX_CRYPTO_SLICE, buf.byteLength);
    crypto.getRandomValues(buf.subarray(offset, end));
  }
  return buf;
}

function createRandomOneMiBBlob(): Blob {
  return new Blob([createRandomOneMiBChunk()], { type: 'application/octet-stream' });
}

/**
 * Builds an upload `Blob` of exact `targetBytes` length by slicing/referencing a single 1 MiB base `Blob`,
 * avoiding repeated `Uint8Array` memory copies, unbounded per-size `Blob` caches, and integer-MiB tail rounding.
 */
export function sliceUploadBlob(unitMiBBlob: Blob, targetBytes: number): Blob {
  const safeBytes = Math.max(1, Math.floor(targetBytes));
  if (safeBytes < MIB) {
    return unitMiBBlob.slice(0, safeBytes, 'application/octet-stream');
  }
  if (safeBytes === MIB) {
    return unitMiBBlob;
  }
  const fullCount = Math.floor(safeBytes / MIB);
  const rem = safeBytes % MIB;
  const parts: BlobPart[] = [];
  for (let i = 0; i < fullCount; i += 1) {
    parts.push(unitMiBBlob);
  }
  if (rem > 0) {
    parts.push(unitMiBBlob.slice(0, rem));
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_PING_TIMEOUT_MS = 5_000;

function createTimedRequestSignal(
  parent: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const onParentAbort = () => ctrl.abort();
  if (parent.aborted) {
    ctrl.abort();
  } else {
    parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  return {
    signal: ctrl.signal,
    didTimeout: () => timedOut && !parent.aborted,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}

export async function runSpeedtestSession(
  opts: SpeedtestOptions,
  signal: AbortSignal
): Promise<SpeedtestProgress> {
  const rpmBudget =
    typeof opts.requestsPerMinute === 'number' &&
    Number.isFinite(opts.requestsPerMinute) &&
    opts.requestsPerMinute > 0
      ? Math.floor(opts.requestsPerMinute)
      : null;
  const requestedPingCount = opts.pingCount ?? 20;
  // Scale ping probe count and worker streams down when the server has a tight per-IP RPM budget (< 120 rpm)
  const pingCount =
    rpmBudget !== null && rpmBudget < 120
      ? Math.min(requestedPingCount, Math.max(4, Math.floor(rpmBudget / 5)))
      : requestedPingCount;
  const budgetStreamCap =
    rpmBudget !== null && rpmBudget < 120
      ? Math.max(1, Math.floor(rpmBudget / 35))
      : 8;
  const maxStreams = Math.min(
    budgetStreamCap,
    Math.max(1, Math.floor(opts.parallelStreams ?? 6))
  );
  const downStreams = Math.min(6, maxStreams);
  const upStreams = Math.min(4, maxStreams);
  const tightRequestBudget = rpmBudget !== null && rpmBudget < 180;
  // Cap per-phase HTTP requests strictly within the 1-minute token bucket so fast links / small chunk caps never self-trigger 429
  const perPhaseRequestCap =
    rpmBudget !== null ? Math.max(1, Math.floor((rpmBudget - pingCount - 2) / 2)) : Infinity;
  const maxDownBytes = Math.max(MIB, Math.floor((opts.maxDownloadMb ?? 256) * MIB));
  const maxUpBytes = Math.max(64 * KIB, Math.floor((opts.maxUploadMb ?? 64) * MIB));
  const durationMs = opts.phaseDurationMs ?? 10_000;
  const warmupMs = opts.warmupMs ?? 2_000;
  const sampleMs = opts.sampleIntervalMs ?? 100;

  const state: SpeedtestProgress = {
    phase: 'ping',
    pingMs: null,
    jitterMs: null,
    downloadMbps: null,
    uploadMbps: null,
    rxSeries: [],
    txSeries: [],
  };

  const emit = () => {
    opts.onProgress({
      ...state,
      rxSeries: [...state.rxSeries],
      txSeries: [...state.txSeries],
    });
  };

  const checkStatus = (status: number) => {
    if (status === 401) {
      throw new SpeedtestRunError('unauthorized', 'HTTP 401');
    }
    if (status === 429) {
      throw new SpeedtestRunError('rate_limited', 'HTTP 429');
    }
    if (status < 200 || status >= 300) {
      throw new SpeedtestRunError('network', `HTTP ${status}`);
    }
  };

  // ==================== 1. Latency & jitter ====================
  const pingTimeoutMs = Math.max(10, Math.floor(opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS));
  emit();
  const rtts: number[] = [];
  for (let i = 0; i < pingCount; i += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const t0 = performance.now();
    const probe = createTimedRequestSignal(signal, pingTimeoutMs);
    let res: Response;
    try {
      res = await fetch(`/api/speed/ping?r=${nonce()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: probe.signal,
      });
    } catch (err) {
      if (probe.didTimeout()) {
        throw new SpeedtestRunError('network', 'Latency probe timed out');
      }
      throw err;
    } finally {
      probe.cleanup();
    }
    checkStatus(res.status);
    const rtt = performance.now() - t0;
    rtts.push(rtt);

    const interim = computePingAndJitter(rtts);
    state.pingMs = interim.medianMs;
    state.jitterMs = interim.jitterMs;
    emit();
  }

  // ==================== 2. Parallel download streams ====================
  state.phase = 'download';
  state.downloadMbps = 0;
  emit();

  state.downloadMbps = await runDownloadPhase({
    streams: downStreams,
    maxChunkBytes: maxDownBytes,
    tightRequestBudget,
    maxRequests: perPhaseRequestCap,
    durationMs,
    warmupMs,
    sampleMs,
    signal,
    checkStatus,
    onTick: (instantMbps, runningResultMbps) => {
      state.rxSeries.push(instantMbps);
      state.downloadMbps = runningResultMbps;
      emit();
    },
  });
  emit();

  // ==================== 3. Parallel upload streams ====================
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  state.phase = 'upload';
  state.uploadMbps = 0;
  emit();

  state.uploadMbps = await runUploadPhase({
    streams: upStreams,
    maxChunkBytes: maxUpBytes,
    tightRequestBudget,
    maxRequests: perPhaseRequestCap,
    durationMs,
    warmupMs,
    sampleMs,
    signal,
    checkStatus,
    onTick: (instantMbps, runningResultMbps) => {
      state.txSeries.push(instantMbps);
      state.uploadMbps = runningResultMbps;
      emit();
    },
  });

  state.phase = 'done';
  emit();
  return state;
}

interface TransferPhaseArgs {
  streams: number;
  maxChunkBytes: number;
  tightRequestBudget?: boolean;
  maxRequests?: number;
  durationMs: number;
  warmupMs: number;
  sampleMs: number;
  signal: AbortSignal;
  checkStatus: (status: number) => void;
  onTick: (instantMbps: number, runningMbps: number) => void;
}

async function runDownloadPhase(args: TransferPhaseArgs): Promise<number> {
  const {
    streams,
    maxChunkBytes,
    tightRequestBudget,
    maxRequests = Infinity,
    durationMs,
    warmupMs,
    sampleMs,
    signal,
    checkStatus,
    onTick,
  } = args;
  const phaseCtrl = new AbortController();
  const onOuterAbort = () => phaseCtrl.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });

  let totalBytes = 0;
  let issuedRequests = 0;
  const startTs = performance.now();
  const checkpoints: ByteCheckpoint[] = [];
  let fatalError: unknown = null;

  const timer = window.setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTs;
    checkpoints.push({ elapsedMs, totalBytes });

    // Compute sliding ~300ms window rate to smooth OS socket burst jitter while keeping fast ramp response
    const lookbackIdx = Math.max(0, checkpoints.length - 4);
    const refPt =
      checkpoints.length <= 3
        ? { elapsedMs: 0, totalBytes: 0 }
        : checkpoints[lookbackIdx];
    const dtSec = Math.max(0.001, (elapsedMs - refPt.elapsedMs) / 1000);
    const deltaBytes = Math.max(0, totalBytes - refPt.totalBytes);
    const instantMbps = (deltaBytes * 8) / (dtSec * 1_000_000);
    const sustained = computeSustainedThroughputMbps(checkpoints, warmupMs);
    onTick(instantMbps, sustained);

    if (elapsedMs >= durationMs) {
      phaseCtrl.abort();
    }
  }, sampleMs);

  const stopDeadline = window.setTimeout(() => phaseCtrl.abort(), durationMs);

  const worker = async () => {
    const maxChunk = Math.max(256 * KIB, maxChunkBytes);
    const minChunk = Math.min(256 * KIB, maxChunk);
    let chunkBytes = Math.min(tightRequestBudget ? 64 * MIB : 8 * MIB, maxChunk);

    while (!phaseCtrl.signal.aborted && performance.now() - startTs < durationMs) {
      if (issuedRequests >= maxRequests) {
        break;
      }
      issuedRequests += 1;
      const reqStart = performance.now();
      try {
        const res = await fetch(`/api/speed/down?size=${chunkBytes}&r=${nonce()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: phaseCtrl.signal,
        });
        checkStatus(res.status);
        const reader = res.body?.getReader();
        if (!reader) break;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
          }
          if (performance.now() - startTs >= durationMs) {
            await reader.cancel();
            break;
          }
        }
        chunkBytes = nextAdaptiveChunkBytes(
          chunkBytes,
          performance.now() - reqStart,
          maxChunk,
          minChunk
        );
      } catch (err) {
        if (phaseCtrl.signal.aborted) break;
        fatalError = err;
        phaseCtrl.abort();
        break;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: streams }, () => worker()));
  } finally {
    window.clearInterval(timer);
    window.clearTimeout(stopDeadline);
    signal.removeEventListener('abort', onOuterAbort);
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (fatalError) {
    throw fatalError;
  }
  if (totalBytes <= 0) {
    throw new SpeedtestRunError('network', 'No download payload received within timeout');
  }

  const finalElapsed = Math.max(1, performance.now() - startTs);
  if (checkpoints.length === 0 && totalBytes > 0) {
    const mbps = (totalBytes * 8) / ((finalElapsed / 1000) * 1_000_000);
    onTick(mbps, mbps);
    return mbps;
  }

  checkpoints.push({ elapsedMs: finalElapsed, totalBytes });
  return computeSustainedThroughputMbps(checkpoints, warmupMs);
}

async function runUploadPhase(args: TransferPhaseArgs): Promise<number> {
  const {
    streams,
    maxChunkBytes,
    tightRequestBudget,
    maxRequests = Infinity,
    durationMs,
    warmupMs,
    sampleMs,
    signal,
    checkStatus,
    onTick,
  } = args;
  const unitBlob = createRandomOneMiBBlob();
  const getBlob = (bytes: number): Blob => sliceUploadBlob(unitBlob, bytes);

  const phaseCtrl = new AbortController();
  let acceptingNew = true;
  let drainStarted = false;
  let hardAbortTimer: number | undefined;
  let issuedRequests = 0;
  const UPLOAD_DRAIN_GRACE_MS = 650;

  const onOuterAbort = () => {
    acceptingNew = false;
    phaseCtrl.abort();
  };
  signal.addEventListener('abort', onOuterAbort, { once: true });

  let totalBytes = 0;
  const startTs = performance.now();
  const checkpoints: ByteCheckpoint[] = [];
  let fatalError: unknown = null;

  const beginGracefulStop = () => {
    if (drainStarted) return;
    drainStarted = true;
    acceptingNew = false;
    window.clearInterval(timer);
    if (!phaseCtrl.signal.aborted) {
      hardAbortTimer = window.setTimeout(() => phaseCtrl.abort(), UPLOAD_DRAIN_GRACE_MS);
    }
  };

  const timer = window.setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTs;
    checkpoints.push({ elapsedMs, totalBytes });

    // Compute server-confirmed rate over the last ~600ms (3 ticks) to smooth beat aliasing between HTTP completions and the 200ms clock
    const lookbackIdx = Math.max(0, checkpoints.length - 4);
    const refPt =
      checkpoints.length <= 3
        ? { elapsedMs: 0, totalBytes: 0 }
        : checkpoints[lookbackIdx];
    const dtSec = Math.max(0.001, (elapsedMs - refPt.elapsedMs) / 1000);
    const deltaBytes = Math.max(0, totalBytes - refPt.totalBytes);
    const instantMbps = (deltaBytes * 8) / (dtSec * 1_000_000);

    const sustained = computeSustainedThroughputMbps(checkpoints, warmupMs);
    onTick(instantMbps, sustained);

    if (elapsedMs >= durationMs) {
      beginGracefulStop();
    }
  }, sampleMs);

  const stopDeadline = window.setTimeout(beginGracefulStop, durationMs);

  const worker = async (workerIdx: number) => {
    // Stagger upload stream startups by 35ms so server acknowledgments distribute evenly across ticks
    if (workerIdx > 0) {
      await new Promise((r) => window.setTimeout(r, workerIdx * 35));
    }

    // Start at 128 KiB (or 1 MiB under tight RPM budgets) so remote links confirm quickly while staying within request limits
    const minChunk = Math.min(64 * KIB, maxChunkBytes);
    const maxChunk = Math.max(minChunk, maxChunkBytes);
    let chunkBytes = Math.min(tightRequestBudget ? MIB : 128 * KIB, maxChunk);
    let lastReqDurationMs = 0;

    while (acceptingNew && !phaseCtrl.signal.aborted) {
      if (issuedRequests >= maxRequests) {
        acceptingNew = false;
        break;
      }
      const remainingMs = durationMs - (performance.now() - startTs);
      const sendBytes = computeTailUploadChunkBytes(
        chunkBytes,
        lastReqDurationMs,
        remainingMs,
        totalBytes > 0,
        minChunk
      );
      if (sendBytes <= 0) break;

      issuedRequests += 1;
      const reqStart = performance.now();
      try {
        const blob = getBlob(sendBytes);
        const res = await fetch(`/api/speed/up?r=${nonce()}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            Accept: 'application/json',
          },
          body: blob,
          cache: 'no-store',
          signal: phaseCtrl.signal,
        });
        checkStatus(res.status);
        const data = (await res.json()) as { receivedBytes?: unknown };
        if (
          typeof data?.receivedBytes !== 'number' ||
          !Number.isFinite(data.receivedBytes) ||
          data.receivedBytes <= 0 ||
          data.receivedBytes > blob.size
        ) {
          throw new SpeedtestRunError(
            'network',
            'Invalid or zero server upload confirmation'
          );
        }
        const confirmed = Math.floor(data.receivedBytes);
        totalBytes += confirmed;

        lastReqDurationMs = Math.max(1, performance.now() - reqStart);
        if (sendBytes === chunkBytes) {
          chunkBytes = nextAdaptiveChunkBytes(
            chunkBytes,
            lastReqDurationMs,
            maxChunk,
            minChunk
          );
        }
      } catch (err) {
        if (phaseCtrl.signal.aborted) break;
        fatalError = err;
        acceptingNew = false;
        phaseCtrl.abort();
        break;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: streams }, (_, idx) => worker(idx)));
  } finally {
    window.clearInterval(timer);
    window.clearTimeout(stopDeadline);
    if (hardAbortTimer !== undefined) {
      window.clearTimeout(hardAbortTimer);
    }
    signal.removeEventListener('abort', onOuterAbort);
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (fatalError) {
    throw fatalError;
  }
  if (totalBytes <= 0) {
    throw new SpeedtestRunError('network', 'No upload payload confirmed within timeout');
  }

  const finalElapsed = Math.max(1, performance.now() - startTs);
  if (checkpoints.length === 0 && totalBytes > 0) {
    const mbps = (totalBytes * 8) / ((finalElapsed / 1000) * 1_000_000);
    onTick(mbps, mbps);
    return mbps;
  }

  checkpoints.push({ elapsedMs: finalElapsed, totalBytes });
  return computeSustainedThroughputMbps(checkpoints, warmupMs);
}
