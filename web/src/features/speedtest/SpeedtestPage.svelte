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
  const TOP_PAD = 8;
  const BOT_Y = 96;

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

  const hasDownReading = $derived(Boolean(previewSample) || liveDown !== null);
  const hasUpReading = $derived(Boolean(previewSample) || liveUp !== null);
  const hasPingReading = $derived(Boolean(previewSample) || livePing !== null);
  const hasJitterReading = $derived(Boolean(previewSample) || liveJitter !== null);

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
    const totalPts = samples.length + 1;
    const denom = Math.max(totalPts - 1, 1);
    const pts: string[] = [`0.0,${BOT_Y.toFixed(1)}`];

    for (let i = 0; i < samples.length; i += 1) {
      const x = ((i + 1) / denom) * VIEW_W;
      const clamped = Math.max(0, Math.min(1, samples[i] / maxVal));
      const y = BOT_Y - clamped * spanY;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    const line = pts.join(' ');
    const lastX = ((totalPts - 1) / denom) * VIEW_W;
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
    sampleIntervalMs: number;
  } {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('quick') === '1') {
        return { pingCount: 6, phaseDurationMs: 1200, warmupMs: 250, sampleIntervalMs: 60 };
      }
    }
    return { pingCount: 20, phaseDurationMs: 10_000, warmupMs: 2_000, sampleIntervalMs: 100 };
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
          sampleIntervalMs: timing.sampleIntervalMs,
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

  <!-- Unified instrument bench: header controls + single recessed display window (4 readouts + dual-channel dot-grid scope) -->
  <section class="plate sp-bench" aria-label={t('title', undefined, 'speedtest')}>
    <header class="sp-bench__head">
      <div class="sp-bench__title">
        <h2>{t('title', undefined, 'speedtest')}</h2>
        <p>{t('subtitle', undefined, 'speedtest')}</p>
      </div>

      <ul class="sp-phases">
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
        <li data-active={effectivePhase === 'done' ? 'true' : undefined}>
          <span class="lamp" data-color={effectivePhase === 'done' ? 'mint' : 'dim'}></span>
          {t('phaseDone', undefined, 'speedtest')}
        </li>
      </ul>

      <div class="sp-bench__action">
        <Button
          variant={isRunning ? 'danger' : 'primary'}
          size="lg"
          icon={isRunning ? 'square' : 'play'}
          onclick={handleStartOrStop}
        >
          {isRunning
            ? t('stopBtn', undefined, 'speedtest')
            : t('startBtn', undefined, 'speedtest')}
        </Button>
      </div>
    </header>

    <div class="screen sp-display">
      <div class="sp-metrics">
        <article
          class="sp-metric"
          data-live={effectivePhase === 'download' ? 'rx' : undefined}
        >
          <span class="sp-metric__label">
            <i class="sp-metric__dot sp-metric__dot--rx" aria-hidden="true"></i>
            {t('metricDown', undefined, 'speedtest')}
          </span>
          <div class="sp-metric__readout mono">
            <b
              class="sp-metric__num sp-metric__num--rx"
              data-idle={!hasDownReading ? 'true' : undefined}
            >
              {downVal}
            </b>
            <small>Mbps</small>
          </div>
        </article>

        <article
          class="sp-metric"
          data-live={effectivePhase === 'upload' ? 'tx' : undefined}
        >
          <span class="sp-metric__label">
            <i class="sp-metric__dot sp-metric__dot--tx" aria-hidden="true"></i>
            {t('metricUp', undefined, 'speedtest')}
          </span>
          <div class="sp-metric__readout mono">
            <b
              class="sp-metric__num sp-metric__num--tx"
              data-idle={!hasUpReading ? 'true' : undefined}
            >
              {upVal}
            </b>
            <small>Mbps</small>
          </div>
        </article>

        <article
          class="sp-metric"
          data-live={effectivePhase === 'ping' ? 'rx' : undefined}
        >
          <span class="sp-metric__label">{t('metricPing', undefined, 'speedtest')}</span>
          <div class="sp-metric__readout mono">
            <b
              class="sp-metric__num"
              data-idle={!hasPingReading ? 'true' : undefined}
            >
              {pingVal}
            </b>
            <small>ms</small>
          </div>
        </article>

        <article
          class="sp-metric"
          data-live={effectivePhase === 'ping' ? 'rx' : undefined}
        >
          <span class="sp-metric__label">{t('metricJitter', undefined, 'speedtest')}</span>
          <div class="sp-metric__readout mono">
            <b
              class="sp-metric__num"
              data-idle={!hasJitterReading ? 'true' : undefined}
            >
              {jitterVal}
            </b>
            <small>ms</small>
          </div>
        </article>
      </div>

      <div class="sp-scope" aria-hidden="true">
        <div class="sp-scope__track">
          <div class="sp-scope__legend">
            <b class="mono">RX</b>
            <small>{t('channelRx', undefined, 'speedtest')}</small>
          </div>

          <div class="sp-scope__plot">
            <svg viewBox="0 0 640 100" preserveAspectRatio="none">
              {#if rxTrace.line}
                <polygon points={rxTrace.area} class="sp-scope__rx-area" />
                <polyline points={rxTrace.line} class="sp-scope__rx" />
              {:else}
                <line x1="0" y1="96" x2="640" y2="96" class="sp-scope__idle" />
              {/if}
            </svg>
          </div>

          <div class="sp-scope__scale mono">
            <span>{scaleTopText}</span>
            <span>{scaleMidText}</span>
            <span>0</span>
          </div>
        </div>

        <div class="sp-scope__track">
          <div class="sp-scope__legend">
            <b class="mono">TX</b>
            <small>{t('channelTx', undefined, 'speedtest')}</small>
          </div>

          <div class="sp-scope__plot">
            <svg viewBox="0 0 640 100" preserveAspectRatio="none">
              {#if txTrace.line}
                <polygon points={txTrace.area} class="sp-scope__tx-area" />
                <polyline points={txTrace.line} class="sp-scope__tx" />
              {:else}
                <line x1="0" y1="96" x2="640" y2="96" class="sp-scope__idle" />
              {/if}
            </svg>
          </div>

          <div class="sp-scope__scale mono">
            <span>{scaleTopText}</span>
            <span>{scaleMidText}</span>
            <span>0</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Browser-local speedtest history ledger -->
  <section class="plate sp-history">
    <header class="sp-history__head">
      <div>
        <h3>{t('historyTitle', undefined, 'speedtest')}</h3>
        <p>{t('historySubtitle', undefined, 'speedtest')}</p>
      </div>
      {#if historyRows.length > 0 && !previewSample}
        <Button variant="secondary" size="sm" onclick={clearSpeedtestHistory}>
          {t('clearHistory', undefined, 'speedtest')}
        </Button>
      {:else if historyRows.length > 0}
        <Button variant="secondary" size="sm">
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
      <div class="sp-table-wrap">
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
                <td class="sp-table__rx">
                  {fmtRate(row.downloadMbps)}<small>Mbps</small>
                </td>
                <td class="sp-table__tx">
                  {fmtRate(row.uploadMbps)}<small>Mbps</small>
                </td>
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
    padding: 0.8125rem 1.0625rem;
    border-radius: var(--r-key);
    background: var(--notice-fault-bg);
    color: var(--fault);
    font-size: 0.84375rem;
    font-weight: 550;
  }

  .sp-bench {
    padding: 1.375rem;
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .sp-bench__head {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .sp-bench__title h2 {
    font-size: 1.1875rem;
    font-weight: 700;
    color: var(--ink);
  }

  .sp-bench__title p {
    margin-top: 0.125rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  .sp-phases {
    list-style: none;
    margin: 0 0 0 auto;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: 1.125rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
    flex-wrap: wrap;
  }

  .sp-phases li {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    white-space: nowrap;
  }

  .sp-phases li[data-active='true'] {
    color: var(--ink);
    font-weight: 650;
  }

  .sp-bench__action {
    flex-shrink: 0;
  }

  /* Unified recessed instrument display window */
  .sp-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .sp-metric {
    padding: 1.25rem 1.5rem 1.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
    transition: background-color 0.2s;
  }

  .sp-metric + .sp-metric {
    box-shadow: inset 1px 0 0 var(--screen-line);
  }

  .sp-metric[data-live='rx'] {
    background: var(--mint-soft);
  }

  .sp-metric[data-live='tx'] {
    background: var(--amber-soft);
  }

  .sp-metric__label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--screen-ink-2);
  }

  .sp-metric__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .sp-metric__dot--rx {
    background: var(--screen-mint);
    box-shadow: 0 0 0.45rem var(--mint-glow);
  }

  .sp-metric__dot--tx {
    background: var(--screen-amber);
    box-shadow: 0 0 0.45rem var(--amber-glow);
  }

  .sp-metric__readout {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .sp-metric__num {
    font-size: 2.625rem;
    font-weight: 600;
    color: var(--screen-ink);
    line-height: 1.1;
    letter-spacing: -0.025em;
    transition:
      color 0.16s,
      opacity 0.16s;
  }

  .sp-metric__num--rx {
    color: var(--screen-mint);
  }

  .sp-metric__num--tx {
    color: var(--screen-amber);
  }

  .sp-metric__num[data-idle='true'] {
    color: var(--screen-ink-2);
    opacity: 0.42;
  }

  .sp-metric__readout small {
    font-size: 0.8125rem;
    font-weight: 450;
    color: var(--screen-ink-2);
  }

  .sp-scope {
    box-shadow: inset 0 1px 0 var(--screen-line);
  }

  .sp-scope__track {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) 3.75rem;
    align-items: stretch;
    height: 8.75rem;
  }

  .sp-scope__track + .sp-scope__track {
    box-shadow: inset 0 1px 0 var(--screen-line);
  }

  .sp-scope__legend {
    padding: 1.0625rem 0 0 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
  }

  .sp-scope__legend b {
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--screen-ink);
  }

  .sp-scope__legend small {
    font-size: 0.75rem;
    color: var(--screen-ink-2);
  }

  .sp-scope__plot {
    position: relative;
    margin: 0.6875rem 0;
    background-image: radial-gradient(circle, var(--screen-dot) 1.1px, transparent 1.6px);
    background-size: 10px 10px;
    background-position: 5px 5px;
  }

  .sp-scope__plot svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .sp-scope__scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding: 0.625rem 0.9375rem 0.625rem 0.5rem;
    font-size: 0.6875rem;
    color: var(--screen-ink-2);
    user-select: none;
  }

  .sp-scope__idle {
    stroke: var(--screen-dot);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
    vector-effect: non-scaling-stroke;
  }

  .sp-scope__rx-area {
    fill: var(--mint-soft);
  }

  .sp-scope__tx-area {
    fill: var(--amber-soft);
  }

  .sp-scope__rx {
    fill: none;
    stroke: var(--screen-mint);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
    stroke-linecap: round;
    filter: drop-shadow(0 0 3px var(--mint-glow));
  }

  .sp-scope__tx {
    fill: none;
    stroke: var(--screen-amber);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
    stroke-linecap: round;
    filter: drop-shadow(0 0 3px var(--amber-glow));
  }

  /* History ledger */
  .sp-history {
    padding: 1.375rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .sp-history__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .sp-history__head h3 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--ink);
  }

  .sp-history__head p {
    margin-top: 0.125rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  .sp-table-wrap {
    overflow-x: auto;
  }

  .sp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .sp-table th {
    font-family: var(--font-sans);
    font-weight: 550;
    font-size: 0.8125rem;
    color: var(--ink-3);
    text-align: right;
    padding: 0.5rem 0.875rem;
    box-shadow: inset 0 -1px 0 var(--hairline);
  }

  .sp-table td {
    padding: 0.75rem 0.875rem;
    text-align: right;
    color: var(--ink);
  }

  .sp-table tbody tr + tr td {
    box-shadow: inset 0 1px 0 var(--hairline);
  }

  .sp-table th:first-child,
  .sp-table td:first-child {
    text-align: left;
  }

  .sp-table__rx {
    color: var(--mint) !important;
    font-weight: 600;
  }

  .sp-table__tx {
    color: var(--amber) !important;
    font-weight: 600;
  }

  .sp-table td small {
    font-size: 0.6875rem;
    font-weight: 450;
    color: var(--ink-3);
    margin-left: 0.3125rem;
  }

  @media (max-width: 960px) {
    .sp-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .sp-metric:nth-child(3) {
      box-shadow: inset 0 1px 0 var(--screen-line);
    }
    .sp-metric:nth-child(4) {
      box-shadow:
        inset 1px 0 0 var(--screen-line),
        inset 0 1px 0 var(--screen-line);
    }
    .sp-phases {
      margin-left: 0;
      width: 100%;
    }
  }

  @media (max-width: 560px) {
    .sp-metrics {
      grid-template-columns: minmax(0, 1fr);
    }
    .sp-metric + .sp-metric {
      box-shadow: inset 0 1px 0 var(--screen-line);
    }
    .sp-scope__track {
      grid-template-columns: 4.75rem minmax(0, 1fr) 2.75rem;
      height: 7.25rem;
    }
    .sp-scope__legend {
      padding-left: 0.9375rem;
    }
  }
</style>
