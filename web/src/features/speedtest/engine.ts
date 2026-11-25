// Browser parallel speedtest engine:
// - 20 sequential pings (cold-start sample discarded; median RTT + mean consecutive jitter)
// - Up to 6 parallel download streams (`ReadableStream` byte counting, adaptive chunk sizing)
// - Up to 4 parallel upload streams (`POST /api/speed/up` server-confirmed byte counting starting at 128 KiB,
//   eliminating false 0 Mbps readings caused by local OS/proxy socket buffering on port-forwarded links)
// - 200ms oscilloscope ticks, 2s warmup window, checkpoint-based sustained throughput; aborts immediately on HTTP 429.

import {
  computePingAndJitter,
  computeSustainedThroughputMbps,
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
  parallelStreams?: number;
  maxDownloadMb?: number;
  maxUploadMb?: number;
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

function buildUploadBlob(unitMiB: Uint8Array<ArrayBuffer>, targetBytes: number): Blob {
  if (targetBytes < unitMiB.byteLength) {
    return new Blob([unitMiB.subarray(0, targetBytes)], {
      type: 'application/octet-stream',
    });
  }
  const count = Math.max(1, Math.round(targetBytes / unitMiB.byteLength));
  const parts: Array<Uint8Array<ArrayBuffer>> = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(unitMiB);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function runSpeedtestSession(
  opts: SpeedtestOptions,
  signal: AbortSignal
): Promise<SpeedtestProgress> {
  const pingCount = opts.pingCount ?? 20;
  const maxStreams = Math.max(1, Math.floor(opts.parallelStreams ?? 6));
  const downStreams = Math.min(6, maxStreams);
  const upStreams = Math.min(4, maxStreams);
  const maxDownBytes = Math.max(MIB, Math.floor((opts.maxDownloadMb ?? 256) * MIB));
  const maxUpBytes = Math.max(64 * KIB, Math.floor((opts.maxUploadMb ?? 64) * MIB));
  const durationMs = opts.phaseDurationMs ?? 10_000;
  const warmupMs = opts.warmupMs ?? 2_000;
  const sampleMs = opts.sampleIntervalMs ?? 200;

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
  emit();
  const rtts: number[] = [];
  for (let i = 0; i < pingCount; i += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const t0 = performance.now();
    const res = await fetch(`/api/speed/ping?r=${nonce()}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
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
  let lastSampleBytes = 0;
  const startTs = performance.now();
  let lastSampleTs = startTs;
  const checkpoints: ByteCheckpoint[] = [];
  let fatalError: unknown = null;

  const timer = window.setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTs;
    const dtSec = Math.max(0.001, (now - lastSampleTs) / 1000);
    const deltaBytes = totalBytes - lastSampleBytes;
    lastSampleBytes = totalBytes;
    lastSampleTs = now;

    checkpoints.push({ elapsedMs, totalBytes });
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
    let chunkBytes = Math.min(8 * MIB, maxChunk);

    while (!phaseCtrl.signal.aborted && performance.now() - startTs < durationMs) {
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
    durationMs,
    warmupMs,
    sampleMs,
    signal,
    checkStatus,
    onTick,
  } = args;
  const randomUnit = createRandomOneMiBChunk();
  const blobCache = new Map<number, Blob>();
  const getBlob = (bytes: number): Blob => {
    let b = blobCache.get(bytes);
    if (!b) {
      b = buildUploadBlob(randomUnit, bytes);
      blobCache.set(bytes, b);
    }
    return b;
  };

  const phaseCtrl = new AbortController();
  const onOuterAbort = () => phaseCtrl.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });

  let totalBytes = 0;
  const startTs = performance.now();
  const checkpoints: ByteCheckpoint[] = [];
  let fatalError: unknown = null;

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
      phaseCtrl.abort();
    }
  }, sampleMs);

  const stopDeadline = window.setTimeout(() => phaseCtrl.abort(), durationMs);

  const worker = async (workerIdx: number) => {
    // Stagger upload stream startups by 35ms so server acknowledgments distribute evenly across ticks
    if (workerIdx > 0) {
      await new Promise((r) => window.setTimeout(r, workerIdx * 35));
    }

    // Start at 128 KiB so even 2..50 Mbps remote port-forwarded links confirm chunks every 50..400ms; fast LANs scale up within 0.3s
    const minChunk = Math.min(64 * KIB, maxChunkBytes);
    const maxChunk = Math.max(minChunk, maxChunkBytes);
    let chunkBytes = Math.min(128 * KIB, maxChunk);

    while (!phaseCtrl.signal.aborted && performance.now() - startTs < durationMs) {
      const reqStart = performance.now();
      try {
        const blob = getBlob(chunkBytes);
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
        const data = (await res.json()) as { receivedBytes?: number };
        const confirmed =
          typeof data.receivedBytes === 'number' && data.receivedBytes > 0
            ? data.receivedBytes
            : blob.size;
        totalBytes += confirmed;

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
    await Promise.all(Array.from({ length: streams }, (_, idx) => worker(idx)));
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
