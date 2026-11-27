import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSpeedtestSession, sliceUploadBlob } from './engine';

describe('speedtest engine upload drain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('slices upload blobs to exact non-integer-MiB byte counts without rounding', () => {
    const unit = new Blob([new Uint8Array(1024 * 1024)], { type: 'application/octet-stream' });
    expect(sliceUploadBlob(unit, 131_072).size).toBe(131_072);
    expect(sliceUploadBlob(unit, 1024 * 1024).size).toBe(1024 * 1024);
    expect(sliceUploadBlob(unit, 1_409_024).size).toBe(1_409_024);
    expect(sliceUploadBlob(unit, 3 * 1024 * 1024 + 49_152).size).toBe(3 * 1024 * 1024 + 49_152);
  });

  it('drains in-flight upload requests gracefully at deadline without aborting POST streams', async () => {
    let abortedUploads = 0;
    let completedUploads = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const sig = init?.signal;

        if (url.startsWith('/api/speed/ping')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }

        if (url.startsWith('/api/speed/down')) {
          const payload = new Uint8Array(64 * 1024);
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              setTimeout(() => {
                ctrl.enqueue(payload);
                ctrl.close();
              }, 25);
            },
          });
          return Promise.resolve(new Response(stream, { status: 200 }));
        }

        if (url.startsWith('/api/speed/up')) {
          const bodyBlob = init?.body as Blob | undefined;
          const size = bodyBlob?.size ?? 65536;
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
              completedUploads += 1;
              resolve(
                new Response(JSON.stringify({ receivedBytes: size }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                })
              );
            }, 65);

            sig?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                abortedUploads += 1;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });
        }

        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      })
    );

    // Ensure window timer helpers exist in Node Vitest environment
    if (typeof globalThis.window === 'undefined') {
      vi.stubGlobal('window', globalThis);
    }

    const ctrl = new AbortController();
    const res = await runSpeedtestSession(
      {
        pingCount: 2,
        parallelStreams: 2,
        phaseDurationMs: 260,
        warmupMs: 60,
        sampleIntervalMs: 50,
        maxUploadMb: 4,
        onProgress: () => {},
      },
      ctrl.signal
    );

    expect(res.phase).toBe('done');
    expect(completedUploads).toBeGreaterThan(0);
    expect(abortedUploads).toBe(0);
    expect(res.uploadMbps).toBeGreaterThan(0);
  });

  it('aborts in-flight upload requests immediately when user clicks Stop', async () => {
    let abortedUploads = 0;
    const ctrl = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const sig = init?.signal;

        if (url.startsWith('/api/speed/ping')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }

        if (url.startsWith('/api/speed/down')) {
          return Promise.resolve(new Response(new Uint8Array(32 * 1024), { status: 200 }));
        }

        if (url.startsWith('/api/speed/up')) {
          return new Promise<Response>((_resolve, reject) => {
            // Simulate user clicking Stop while upload is in-flight
            setTimeout(() => ctrl.abort(), 20);
            sig?.addEventListener(
              'abort',
              () => {
                abortedUploads += 1;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });
        }

        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      })
    );

    if (typeof globalThis.window === 'undefined') {
      vi.stubGlobal('window', globalThis);
    }

    await expect(
      runSpeedtestSession(
        {
          pingCount: 1,
          parallelStreams: 2,
          phaseDurationMs: 500,
          warmupMs: 50,
          sampleIntervalMs: 50,
          onProgress: () => {},
        },
        ctrl.signal
      )
    ).rejects.toThrow(/Aborted/);

    expect(abortedUploads).toBeGreaterThan(0);
  });
});
