<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SpeedtestLimitsMeta } from '../../lib/api';
  import {
    formatDateTime,
    formatNumber,
    registerLocaleGlob,
    t,
    type MessageTree,
  } from '../../lib/i18n/index.svelte';
  import { Button, EmptyState } from '../../ui';
  import {
    runSpeedtestSession,
    SpeedtestRunError,
    type SpeedtestPhase,
  } from './engine';
  import {
    clearSpeedtestHistory,
    getSpeedtestHistory,
    recordSpeedtestRun,
    type SpeedtestHistoryEntry,
  } from './history.svelte';

  registerLocaleGlob(
    'speedtest',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  interface Props {
    speedtestLimits?: SpeedtestLimitsMeta;
    onunauthorized?: () => void;
    previewSample?: {
      downloadMbps: number;
      uploadMbps: number;
      pingMs: number;
      jitterMs: number;
      rxSeries: number[];
      txSeries: number[];
      history: SpeedtestHistoryEntry[];
    };
  }

  let { speedtestLimits, onunauthorized, previewSample }: Props = $props();

  const VIEW_W = 640;
  const TOP_PAD = 12;
  const BOT_Y = 98;

  let phase = $state<SpeedtestPhase>('idle');
  let liveDown = $state<number | null>(null);
  let liveUp = $state<number | null>(null);
  let livePing = $state<number | null>(null);
  let liveJitter = $state<number | null>(null);
  let liveRxSeries = $state<number[]>([]);
  let liveTxSeries = $state<number[]>([]);
  let bannerMsg = $state('');

  let runController: AbortController | null = null;

  const isRunning = $derived(
    phase === 'ping' || phase === 'download' || phase === 'upload'
  );

  const effectivePhase = $derived<SpeedtestPhase>(
    previewSample ? 'done' : phase
  );

  const downVal = $derived(
    previewSample
      ? fmtRate(previewSample.downloadMbps)
      : liveDown !== null
        ? fmtRate(liveDown)
        : '0.0'
  );
  const upVal = $derived(
    previewSample
      ? fmtRate(previewSample.uploadMbps)
      : liveUp !== null
        ? fmtRate(liveUp)
        : '0.0'
  );
  const pingVal = $derived(
    previewSample
      ? fmtMs(previewSample.pingMs)
      : livePing !== null
        ? fmtMs(livePing)
        : '0.00'
  );
  const jitterVal = $derived(
    previewSample
      ? fmtMs(previewSample.jitterMs)
      : liveJitter !== null
        ? fmtMs(liveJitter)
        : '0.00'
  );

  const rxSamples = $derived(previewSample ? previewSample.rxSeries : liveRxSeries);
  const txSamples = $derived(previewSample ? previewSample.txSeries : liveTxSeries);

  const scaleMax = $derived.by(() => {
    let peak = 20;
    for (const v of rxSamples) if (v > peak) peak = v;
    for (const v of txSamples) if (v > peak) peak = v;
    const rawTop = peak * 1.15;
    if (rawTop <= 50) return Math.ceil(rawTop / 10) * 10;
    if (rawTop <= 200) return Math.ceil(rawTop / 25) * 25;
    return Math.ceil(rawTop / 100) * 100;
  });

  const scaleTopText = $derived(`${Math.round(scaleMax)}M`);
  const scaleMidText = $derived(`${Math.round(scaleMax / 2)}M`);

  function toRawPolyline(samples: readonly number[], maxVal: number): {
    line: string;
    area: string;
  } {
    if (samples.length === 0) return { line: '', area: '' };
    const spanY = BOT_Y - TOP_PAD;
    const denom = Math.max(samples.length - 1, 1);
    const pts: string[] = [];

    for (let i = 0; i < samples.length; i += 1) {
      const x = (i / denom) * VIEW_W;
      const clamped = Math.max(0, Math.min(1, samples[i] / maxVal));
      const y = BOT_Y - clamped * spanY;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    const line = pts.join(' ');
    const lastX = ((samples.length - 1) / denom) * VIEW_W;
    const area = `0,${BOT_Y} ${line} ${lastX.toFixed(1)},${BOT_Y}`;
    return { line, area };
  }

  const rxTrace = $derived(toRawPolyline(rxSamples, scaleMax));
  const txTrace = $derived(toRawPolyline(txSamples, scaleMax));

  const historyRows = $derived(previewSample ? previewSample.history : getSpeedtestHistory());

  function readTimingParams(): {
    pingCount: number;
    phaseDurationMs: number;
    warmupMs: number;
  } {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('quick') === '1') {
        return { pingCount: 6, phaseDurationMs: 1200, warmupMs: 250 };
      }
    }
    return { pingCount: 20, phaseDurationMs: 10_000, warmupMs: 2_000 };
  }

  async function handleStartOrStop() {
    if (previewSample) return;

    if (isRunning) {
      runController?.abort();
      runController = null;
      phase = 'aborted';
      return;
    }

    bannerMsg = '';
    liveDown = null;
    liveUp = null;
    livePing = null;
    liveJitter = null;
    liveRxSeries = [];
    liveTxSeries = [];

    const ctrl = new AbortController();
    runController = ctrl;
    const timing = readTimingParams();

    try {
      const finalSnap = await runSpeedtestSession(
        {
          pingCount: timing.pingCount,
          parallelStreams: speedtestLimits?.maxStreams,
          maxDownloadMb: speedtestLimits?.maxDownloadMb,
          maxUploadMb: speedtestLimits?.maxUploadMb,
          requestsPerMinute: speedtestLimits?.requestsPerMinute,
          phaseDurationMs: timing.phaseDurationMs,
          warmupMs: timing.warmupMs,
          onProgress: (snap) => {
            if (runController !== ctrl) return;
            phase = snap.phase;
            livePing = snap.pingMs;
            liveJitter = snap.jitterMs;
            liveDown = snap.downloadMbps;
            liveUp = snap.uploadMbps;
            liveRxSeries = snap.rxSeries;
            liveTxSeries = snap.txSeries;
          },
        },
        ctrl.signal
      );

      if (runController !== ctrl) return;

      if (
        finalSnap.downloadMbps !== null &&
        finalSnap.uploadMbps !== null &&
        finalSnap.pingMs !== null &&
        finalSnap.jitterMs !== null
      ) {
        recordSpeedtestRun({
          timestamp: Date.now(),
          downloadMbps: finalSnap.downloadMbps,
          uploadMbps: finalSnap.uploadMbps,
          pingMs: finalSnap.pingMs,
          jitterMs: finalSnap.jitterMs,
        });
      }
    } catch (err) {
      if (runController !== ctrl) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        phase = 'aborted';
      } else if (err instanceof SpeedtestRunError) {
        phase = 'error';
        if (err.kind === 'unauthorized') {
          onunauthorized?.();
        } else if (err.kind === 'rate_limited') {
          bannerMsg = t('rateLimitedBanner', undefined, 'speedtest');
        } else {
          bannerMsg = t('networkErrorBanner', { reason: err.message }, 'speedtest');
        }
      } else {
        phase = 'error';
        bannerMsg = t(
          'networkErrorBanner',
          { reason: err instanceof Error ? err.message : String(err) },
          'speedtest'
        );
      }
    } finally {
      if (runController === ctrl) {
        runController = null;
      }
    }
  }

  onDestroy(() => {
    runController?.abort();
    runController = null;
  });

  function fmtRate(v: number): string {
    return formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function fmtMs(v: number): string {
    return formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
</script>

<div class="sp-page">
  {#if bannerMsg}
    <div class="sp-banner" role="alert">
      <span class="lamp" data-color="fault"></span>
      <span>{bannerMsg}</span>
    </div>
  {/if}

  <!-- Section 1: 4-column symmetric metric readouts (active phase illuminates a subtle border accent) -->
  <section class="sp-metrics" aria-label={t('title', undefined, 'speedtest')}>
    <article
      class="plate sp-metric"
      data-live={effectivePhase === 'download' ? 'rx' : undefined}
    >
      <span class="sp-metric__label">{t('metricDown', undefined, 'speedtest')}</span>
      <div class="sp-metric__readout mono">
        <b class="sp-metric__num sp-metric__num--rx">{downVal}</b>
        <small>Mbps</small>
      </div>
    </article>

    <article
      class="plate sp-metric"
      data-live={effectivePhase === 'upload' ? 'tx' : undefined}
    >
      <span class="sp-metric__label">{t('metricUp', undefined, 'speedtest')}</span>
      <div class="sp-metric__readout mono">
        <b class="sp-metric__num sp-metric__num--tx">{upVal}</b>
        <small>Mbps</small>
      </div>
    </article>

    <article
      class="plate sp-metric"
      data-live={effectivePhase === 'ping' ? 'rx' : undefined}
    >
      <span class="sp-metric__label">{t('metricPing', undefined, 'speedtest')}</span>
      <div class="sp-metric__readout mono">
        <b class="sp-metric__num">{pingVal}</b>
        <small>ms</small>
      </div>
    </article>

    <article
      class="plate sp-metric"
      data-live={effectivePhase === 'ping' ? 'rx' : undefined}
    >
      <span class="sp-metric__label">{t('metricJitter', undefined, 'speedtest')}</span>
      <div class="sp-metric__readout mono">
        <b class="sp-metric__num">{jitterVal}</b>
        <small>ms</small>
      </div>
    </article>
  </section>

  <!-- Section 2: Dual-channel real-time oscilloscope viewport with adaptive scale ticks -->
  <section class="plate sp-bench">
    <header class="sp-bench__head">
      <div class="sp-bench__title">
        <h2>{t('title', undefined, 'speedtest')}</h2>
        <p>{t('subtitle', undefined, 'speedtest')}</p>
      </div>

      <ul class="sp-phases">
        <li data-active={effectivePhase === 'idle' || effectivePhase === 'aborted' ? 'true' : undefined}>
          <span
            class="lamp"
            data-color={effectivePhase === 'idle' || effectivePhase === 'aborted' ? 'amber' : 'dim'}
          ></span>
          {t('phaseIdle', undefined, 'speedtest')}
        </li>
        <li data-active={effectivePhase === 'ping' ? 'true' : undefined}>
          <span class="lamp" data-color={effectivePhase === 'ping' ? 'mint' : 'dim'}></span>
          {t('phasePing', undefined, 'speedtest')}
        </li>
        <li data-active={effectivePhase === 'download' ? 'true' : undefined}>
          <span class="lamp" data-color={effectivePhase === 'download' ? 'mint' : 'dim'}></span>
          {t('phaseDown', undefined, 'speedtest')}
        </li>
        <li data-active={effectivePhase === 'upload' ? 'true' : undefined}>
          <span class="lamp" data-color={effectivePhase === 'upload' ? 'amber' : 'dim'}></span>
          {t('phaseUp', undefined, 'speedtest')}
        </li>
        {#if effectivePhase === 'done'}
          <li data-active="true">
            <span class="lamp" data-color="mint"></span>
            {t('phaseDone', undefined, 'speedtest')}
          </li>
        {/if}
      </ul>

      <div class="sp-bench__action">
        <Button
          variant={isRunning ? 'danger' : 'primary'}
          onclick={handleStartOrStop}
        >
          {isRunning
            ? t('stopBtn', undefined, 'speedtest')
            : t('startBtn', undefined, 'speedtest')}
        </Button>
      </div>
    </header>

    <div class="glass sp-scope" aria-hidden="true">
      <div class="sp-scope__track">
        <div class="sp-scope__legend">
          <div class="sp-scope__ch">
            <span class="lamp" data-color="mint"></span>
            <b class="mono">RX</b>
          </div>
          <small>{t('channelRx', undefined, 'speedtest')}</small>
        </div>

        <svg viewBox="0 0 640 108" preserveAspectRatio="none">
          <line x1="0" y1="12" x2="640" y2="12" class="sp-scope__guide" />
          <line x1="0" y1="55" x2="640" y2="55" class="sp-scope__guide" />
          <line x1="0" y1="98" x2="640" y2="98" class="sp-scope__guide" />
          {#if rxTrace.line}
            <polygon points={rxTrace.area} class="sp-scope__rx-area" />
            <polyline points={rxTrace.line} class="sp-scope__rx" />
          {:else}
            <line x1="0" y1="98" x2="640" y2="98" class="sp-scope__idle" />
          {/if}
        </svg>

        <div class="sp-scope__scale mono">
          <span>{scaleTopText}</span>
          <span>{scaleMidText}</span>
          <span>0</span>
        </div>
      </div>

      <div class="sp-scope__track">
        <div class="sp-scope__legend">
          <div class="sp-scope__ch">
            <span class="lamp" data-color="amber"></span>
            <b class="mono">TX</b>
          </div>
          <small>{t('channelTx', undefined, 'speedtest')}</small>
        </div>

        <svg viewBox="0 0 640 108" preserveAspectRatio="none">
          <line x1="0" y1="12" x2="640" y2="12" class="sp-scope__guide" />
          <line x1="0" y1="55" x2="640" y2="55" class="sp-scope__guide" />
          <line x1="0" y1="98" x2="640" y2="98" class="sp-scope__guide" />
          {#if txTrace.line}
            <polygon points={txTrace.area} class="sp-scope__tx-area" />
            <polyline points={txTrace.line} class="sp-scope__tx" />
          {:else}
            <line x1="0" y1="98" x2="640" y2="98" class="sp-scope__idle" />
          {/if}
        </svg>

        <div class="sp-scope__scale mono">
          <span>{scaleTopText}</span>
          <span>{scaleMidText}</span>
          <span>0</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Section 3: Browser-local speedtest history ledger -->
  <section class="plate sp-history">
    <header class="sp-history__head">
      <div>
        <h3>{t('historyTitle', undefined, 'speedtest')}</h3>
        <p>{t('historySubtitle', undefined, 'speedtest')}</p>
      </div>
      {#if historyRows.length > 0 && !previewSample}
        <Button variant="ghost" size="sm" onclick={clearSpeedtestHistory}>
          {t('clearHistory', undefined, 'speedtest')}
        </Button>
      {:else if historyRows.length > 0}
        <Button variant="ghost" size="sm">
          {t('clearHistory', undefined, 'speedtest')}
        </Button>
      {/if}
    </header>

    {#if historyRows.length === 0}
      <EmptyState
        title={t('emptyHistoryTitle', undefined, 'speedtest')}
        reason={t('emptyHistoryReason', undefined, 'speedtest')}
      />
    {:else}
      <div class="glass sp-table-wrap">
        <table class="sp-table mono">
          <thead>
            <tr>
              <th>{t('colTime', undefined, 'speedtest')}</th>
              <th>{t('colDown', undefined, 'speedtest')}</th>
              <th>{t('colUp', undefined, 'speedtest')}</th>
              <th>{t('colLatency', undefined, 'speedtest')}</th>
            </tr>
          </thead>
          <tbody>
            {#each historyRows as row (row.id)}
              <tr>
                <td>{formatDateTime(row.timestamp)}</td>
                <td class="sp-table__rx">{fmtRate(row.downloadMbps)} Mbps</td>
                <td class="sp-table__tx">{fmtRate(row.uploadMbps)} Mbps</td>
                <td>{fmtMs(row.pingMs)} ms / ±{fmtMs(row.jitterMs)} ms</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .sp-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .sp-banner {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-radius: var(--r-key);
    background: var(--notice-fault-bg);
    color: var(--fault);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .sp-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--gap);
  }

  .sp-metric {
    padding: 1.0625rem 1.125rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.4375rem;
    transition: box-shadow 0.2s, background-color 0.2s;
  }

  .sp-metric[data-live='rx'] {
    box-shadow:
      inset 0 0 0 1px rgb(114 230 201 / 0.45),
      var(--plate-shadow);
  }

  .sp-metric[data-live='tx'] {
    box-shadow:
      inset 0 0 0 1px rgb(246 176 50 / 0.5),
      var(--plate-shadow);
  }

  .sp-metric__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
    letter-spacing: 0.05em;
  }

  .sp-metric__readout {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3125rem;
  }

  .sp-metric__num {
    font-size: 1.875rem;
    font-weight: 700;
    color: var(--ink);
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  .sp-metric__num--rx {
    color: var(--mint);
  }

  .sp-metric__num--tx {
    color: var(--amber);
  }

  .sp-metric__readout small {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--ink-3);
  }

  .sp-bench {
    padding: 1.1875rem 1.3125rem 1.3125rem;
    display: flex;
    flex-direction: column;
    gap: 1.0625rem;
  }

  .sp-bench__head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
  }

  .sp-bench__title h2 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ink);
  }

  .sp-bench__title p {
    margin-top: 0.1875rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .sp-phases {
    list-style: none;
    margin: 0;
    padding: 0.375rem 0.8125rem;
    border-radius: var(--r-key);
    background: var(--glass);
    display: inline-flex;
    align-items: center;
    gap: 0.875rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .sp-phases li {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    white-space: nowrap;
  }

  .sp-phases li[data-active='true'] {
    color: var(--ink);
    font-weight: 600;
  }

  .sp-bench__action {
    justify-self: end;
  }

  .sp-scope {
    padding: 0.25rem 0.75rem 0.25rem 0;
    background-image: linear-gradient(90deg, var(--scope-grid) 1px, transparent 1px);
    background-size: 3.25rem 100%;
    background-position: 6.75rem 0;
  }

  .sp-scope__track {
    display: grid;
    grid-template-columns: 6.75rem minmax(0, 1fr) 3.25rem;
    align-items: stretch;
    padding: 0.5rem 0;
  }

  .sp-scope__track + .sp-scope__track {
    border-top: 1px dashed var(--scope-grid);
  }

  .sp-scope__legend {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    padding-left: 1rem;
  }

  .sp-scope__ch {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .sp-scope__ch b {
    font-size: 0.8125rem;
    color: var(--ink);
  }

  .sp-scope__legend small {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .sp-scope svg {
    width: 100%;
    height: 6.5rem;
    display: block;
  }

  .sp-scope__scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding: 0.375rem 0.25rem 0.375rem 0.5rem;
    font-size: 0.625rem;
    color: var(--ink-3);
    user-select: none;
  }

  .sp-scope__guide {
    stroke: var(--scope-grid);
    stroke-width: 1;
  }

  .sp-scope__idle {
    stroke: var(--scope-grid);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
  }

  .sp-scope__rx-area {
    fill: var(--mint-soft);
  }

  .sp-scope__tx-area {
    fill: var(--amber-soft);
  }

  .sp-scope__rx {
    fill: none;
    stroke: var(--mint);
    stroke-width: 1.9;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 2.5px var(--mint-glow));
  }

  .sp-scope__tx {
    fill: none;
    stroke: var(--amber);
    stroke-width: 1.9;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 2.5px var(--amber-glow));
  }

  .sp-history {
    padding: 1.125rem 1.3125rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .sp-history__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .sp-history__head h3 {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--ink);
  }

  .sp-history__head p {
    margin-top: 0.1875rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .sp-table-wrap {
    overflow-x: auto;
  }

  .sp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78125rem;
    table-layout: fixed;
  }

  .sp-table th,
  .sp-table td {
    padding: 0.625rem 1rem;
    text-align: center;
  }

  .sp-table th:first-child,
  .sp-table td:first-child {
    text-align: left;
  }

  .sp-table th:last-child,
  .sp-table td:last-child {
    text-align: right;
  }

  .sp-table thead th {
    color: var(--ink-3);
    font-weight: 600;
    border-bottom: 1px solid var(--hairline);
  }

  .sp-table tbody tr + tr td {
    border-top: 1px solid var(--hairline);
  }

  .sp-table tbody td {
    color: var(--ink);
  }

  .sp-table__rx {
    color: var(--mint) !important;
    font-weight: 600;
  }

  .sp-table__tx {
    color: var(--amber) !important;
    font-weight: 600;
  }

  @media (max-width: 960px) {
    .sp-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .sp-bench__head {
      grid-template-columns: minmax(0, 1fr);
      justify-items: start;
    }
    .sp-bench__action {
      justify-self: start;
    }
  }

  @media (max-width: 560px) {
    .sp-metrics {
      grid-template-columns: minmax(0, 1fr);
    }
    .sp-phases {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .sp-scope__track {
      grid-template-columns: 4.75rem minmax(0, 1fr) 2.5rem;
    }
    .sp-scope__legend {
      padding-left: 0.625rem;
    }
    .sp-scope__legend small {
      display: none;
    }
  }
</style>
