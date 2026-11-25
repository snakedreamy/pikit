<script lang="ts">
  import { onMount } from 'svelte';
  import { cssVars } from '../../lib/actions/cssVars';
  import { ApiHttpError } from '../../lib/api';
  import {
    formatBytes,
    formatNumber,
    registerLocaleGlob,
    t,
    type MessageTree,
  } from '../../lib/i18n/index.svelte';
  import { Icon } from '../../ui';
  import { fetchSystemTelemetry } from './api';
  import {
    aggregateCoreBuckets,
    MAX_INLINE_DISK_TABS,
    type CoreBucket,
  } from './telemetry-buckets';
  import type { DiskTelemetry, SystemTelemetrySnapshot } from './types';

  registerLocaleGlob(
    'dashboard',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  interface Props {
    systemEnabled?: boolean;
    perCoreEnabled?: boolean;
    previewTelemetry?: SystemTelemetrySnapshot | null;
    onunauthorized?: () => void;
  }

  let {
    systemEnabled = true,
    perCoreEnabled = true,
    previewTelemetry = undefined,
    onunauthorized,
  }: Props = $props();

  let liveSnapshot = $state<SystemTelemetrySnapshot | null>(null);
  let selectedDiskIdx = $state(0);

  const snapshot = $derived<SystemTelemetrySnapshot | null>(
    !systemEnabled
      ? null
      : previewTelemetry !== undefined
        ? previewTelemetry
        : liveSnapshot
  );

  const disks = $derived(snapshot?.disks ?? []);
  const safeDiskIdx = $derived(
    disks.length === 0 ? 0 : Math.min(selectedDiskIdx, disks.length - 1)
  );
  const activeDisk = $derived<DiskTelemetry | undefined>(disks[safeDiskIdx]);

  const coreBuckets = $derived<CoreBucket[]>(
    perCoreEnabled && snapshot?.cpu?.perCore
      ? aggregateCoreBuckets(snapshot.cpu.perCore)
      : []
  );

  const visibleColumns = $derived(
    !snapshot
      ? 0
      : (snapshot.cpu ? 1 : 0) + (snapshot.memory ? 1 : 0) + (disks.length > 0 ? 1 : 0)
  );

  onMount(() => {
    if (previewTelemetry !== undefined || !systemEnabled) {
      return;
    }

    const ctrl = new AbortController();
    let activeIntervalMs = 1000;
    let timer: number | null = null;
    let inFlight = false;

    const pollOnce = async () => {
      if (!systemEnabled || document.hidden || inFlight || ctrl.signal.aborted) return;
      inFlight = true;
      try {
        const snap = await fetchSystemTelemetry(ctrl.signal);
        if (ctrl.signal.aborted) return;
        liveSnapshot = snap;
        if (snap) {
          const nextIntervalMs = Math.max(1, snap.refreshSeconds ?? 1) * 1000;
          if (nextIntervalMs !== activeIntervalMs) {
            activeIntervalMs = nextIntervalMs;
            if (timer !== null) window.clearInterval(timer);
            timer = window.setInterval(pollOnce, activeIntervalMs);
          }
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          onunauthorized?.();
        }
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (!document.hidden) {
        pollOnce();
      }
    };

    timer = window.setInterval(pollOnce, activeIntervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    pollOnce();

    return () => {
      ctrl.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  });

  function clampRatio(pct: number): number {
    if (!Number.isFinite(pct)) return 0;
    return Math.min(1, Math.max(0, pct / 100));
  }

  function toneForPercent(pct: number): 'mint' | 'amber' | 'fault' {
    if (pct >= 90) return 'fault';
    if (pct >= 75) return 'amber';
    return 'mint';
  }

  function fmtPct(pct: number): string {
    return `${formatNumber(pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function formatCoreBucketTooltip(b: CoreBucket): string {
    if (b.startIndex === b.endIndex) {
      return t(
        'coreTooltip',
        { index: b.startIndex, percent: b.percent.toFixed(1) },
        'dashboard'
      );
    }
    return t(
      'coreRangeTooltip',
      {
        start: b.startIndex,
        end: b.endIndex,
        percent: b.percent.toFixed(1),
      },
      'dashboard'
    );
  }

  function formatDiskTooltip(d: DiskTelemetry): string {
    if (d.error) {
      return t('diskError', { reason: d.error }, 'dashboard');
    }
    const parts = [d.label];
    if (d.device) parts.push(d.device);
    if (d.fsType) parts.push(`(${d.fsType})`);
    parts.push(d.path);
    parts.push(`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`);
    return parts.join(' · ');
  }
</script>

{#if snapshot && visibleColumns > 0}
  <div class="sys-strip-bezel">
    <section
      class="sys-strip"
      data-cols={visibleColumns}
      aria-label={t('telemetryAria', undefined, 'dashboard')}
    >
      {#if snapshot.cpu}
        {@const cpu = snapshot.cpu}
        <div class="sys-bay">
          <div class="sys-bay__lead">
            <span class="sys-bay__icon" data-tone={toneForPercent(cpu.percent)} aria-hidden="true">
              <Icon name="cpu" size="xs" />
            </span>
            <b>{t('cpu', undefined, 'dashboard')}</b>
            <span class="sys-bay__meta mono">
              {cpu.usedCoresText
                ? `${cpu.usedCoresText}/${t('cores', { count: cpu.totalCores }, 'dashboard')}`
                : t('cores', { count: cpu.totalCores }, 'dashboard')}
            </span>
          </div>

          <div class="sys-bay__gauge">
            {#if coreBuckets.length > 0}
              <div class="sys-cores" role="img" aria-label={fmtPct(cpu.percent)}>
                {#each coreBuckets as bucket (bucket.startIndex)}
                  <span
                    class="sys-cores__slot"
                    title={formatCoreBucketTooltip(bucket)}
                  >
                    <span
                      class="sys-cores__bar"
                      data-tone={toneForPercent(bucket.percent)}
                      use:cssVars={{
                        'core-fill': Math.max(0.1, clampRatio(bucket.percent)).toFixed(3),
                      }}
                    ></span>
                  </span>
                {/each}
              </div>
            {:else}
              <div class="sys-meter">
                <span
                  class="sys-meter__fill"
                  data-tone={toneForPercent(cpu.percent)}
                  use:cssVars={{ 'bar-fill': clampRatio(cpu.percent).toFixed(4) }}
                ></span>
              </div>
            {/if}
          </div>

          <output
            class="mono sys-bay__val"
            data-tone={toneForPercent(cpu.percent)}
            title={cpu.source === 'cgroup'
              ? t('sourceCgroup', undefined, 'dashboard')
              : t('sourceHost', undefined, 'dashboard')}
          >
            {fmtPct(cpu.percent)}
          </output>
        </div>
      {/if}

      {#if snapshot.memory}
        {@const mem = snapshot.memory}
        <div class="sys-bay">
          <div class="sys-bay__lead">
            <span class="sys-bay__icon" data-tone={toneForPercent(mem.percent)} aria-hidden="true">
              <Icon name="memory-stick" size="xs" />
            </span>
            <b>{t('memory', undefined, 'dashboard')}</b>
            <span class="sys-bay__meta mono">
              {formatBytes(mem.usedBytes)} / {formatBytes(mem.totalBytes)}
            </span>
          </div>

          <div class="sys-bay__gauge">
            <div class="sys-meter">
              <span
                class="sys-meter__fill"
                data-tone={toneForPercent(mem.percent)}
                use:cssVars={{ 'bar-fill': clampRatio(mem.percent).toFixed(4) }}
              ></span>
            </div>
          </div>

          <output
            class="mono sys-bay__val"
            data-tone={toneForPercent(mem.percent)}
            title={mem.source === 'cgroup'
              ? t('sourceCgroup', undefined, 'dashboard')
              : t('sourceHost', undefined, 'dashboard')}
          >
            {fmtPct(mem.percent)}
          </output>
        </div>
      {/if}

      {#if activeDisk}
        {@const diskTone = activeDisk.error ? 'fault' : toneForPercent(activeDisk.percent)}
        <div class="sys-bay sys-bay--storage">
          <div class="sys-bay__lead">
            <span class="sys-bay__icon" data-tone={diskTone} aria-hidden="true">
              <Icon name="hard-drive" size="xs" />
            </span>
            <b>{t('storage', undefined, 'dashboard')}</b>
            {#if disks.length === 1}
              <span class="sys-bay__meta mono" title={formatDiskTooltip(activeDisk)}>
                {activeDisk.label}
              </span>
            {:else if disks.length <= MAX_INLINE_DISK_TABS}
              <div class="sys-disk-tabs" role="tablist">
                {#each disks as d, idx (`${d.path}:${d.label}`)}
                  {@const warn = Boolean(d.error) || d.percent >= 90}
                  <button
                    type="button"
                    role="tab"
                    class="sys-disk-tab mono"
                    aria-selected={idx === safeDiskIdx ? 'true' : 'false'}
                    data-warn={warn ? 'true' : undefined}
                    title={formatDiskTooltip(d)}
                    onclick={() => (selectedDiskIdx = idx)}
                  >
                    {d.label}
                  </button>
                {/each}
              </div>
            {:else}
              <!-- Switch to a compact dropdown when 4..24+ disks are mounted so narrow bays never clip tabs -->
              <div class="sys-disk-select-wrap">
                <select
                  name="telemetry-disk-selector"
                  class="sys-disk-select mono"
                  aria-label={t('selectDiskAria', undefined, 'dashboard')}
                  title={formatDiskTooltip(activeDisk)}
                  value={String(safeDiskIdx)}
                  onchange={(e) => {
                    selectedDiskIdx = Number((e.currentTarget as HTMLSelectElement).value) || 0;
                  }}
                >
                  {#each disks as d, idx (`${d.path}:${d.label}`)}
                    <option value={String(idx)}>
                      {d.label} ({d.error ? '!' : fmtPct(d.percent)})
                    </option>
                  {/each}
                </select>
                <span class="sys-disk-select__chevron" aria-hidden="true">
                  <Icon name="chevron-down" size="xs" />
                </span>
              </div>
            {/if}
          </div>

          {#if !activeDisk.error}
            <span class="sys-bay__cap mono" title={formatDiskTooltip(activeDisk)}>
              {formatBytes(activeDisk.usedBytes)} / {formatBytes(activeDisk.totalBytes)}
            </span>
          {/if}

          <output
            class="mono sys-bay__val"
            data-tone={diskTone}
            title={formatDiskTooltip(activeDisk)}
          >
            {activeDisk.error ? '!' : fmtPct(activeDisk.percent)}
          </output>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  /* Recessed hardware telemetry sub-bar stepped smoothly beneath the top bar */
  .sys-strip-bezel {
    width: 100%;
    background: var(--strip-bg);
    border-top: 1px solid var(--hairline);
    box-shadow: inset 0 1px 2px var(--strip-shadow);
  }

  .sys-strip {
    max-width: var(--layout-max, 88rem);
    margin: 0 auto;
    padding: 0 var(--gap);
    min-height: 2.375rem;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
  }

  .sys-strip[data-cols='2'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sys-strip[data-cols='1'] {
    grid-template-columns: minmax(0, 1fr);
  }

  .sys-bay {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    padding: 0.375rem 0.875rem;
    min-width: 0;
  }

  .sys-bay:first-child {
    padding-left: 0;
  }

  .sys-bay:last-child {
    padding-right: 0;
  }

  .sys-bay + .sys-bay {
    border-left: 1px solid var(--hairline);
  }

  .sys-bay__lead {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
    flex-shrink: 0;
  }

  .sys-bay__icon {
    display: inline-flex;
    color: var(--mint-dim);
  }

  .sys-bay__icon[data-tone='amber'] {
    color: var(--amber);
  }

  .sys-bay__icon[data-tone='fault'] {
    color: var(--fault);
  }

  .sys-bay__lead b {
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.03em;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .sys-bay__meta {
    font-size: 0.6875rem;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .sys-bay__cap {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .sys-bay__gauge {
    flex: 1;
    min-width: 2.75rem;
    max-width: 7rem;
    display: flex;
    align-items: center;
    margin-left: auto;
  }

  .sys-bay__val {
    flex-shrink: 0;
    min-width: 3.125rem;
    text-align: right;
    font-size: 0.78125rem;
    font-weight: 700;
    color: var(--ink);
  }

  .sys-bay__val[data-tone='amber'] {
    color: var(--amber);
  }

  .sys-bay__val[data-tone='fault'] {
    color: var(--fault);
  }

  /* Recessed meter well stepped darker than the strip background */
  .sys-meter {
    position: relative;
    width: 100%;
    height: 0.4375rem;
    border-radius: 0.1875rem;
    background: var(--strip-well);
    box-shadow: inset 0 1px 1.5px rgb(0 0 0 / 0.22);
    overflow: hidden;
  }

  .sys-meter__fill {
    display: block;
    width: 100%;
    height: 100%;
    transform-origin: left center;
    transform: scaleX(var(--bar-fill, 0));
    transition: transform 180ms var(--ease-out);
  }

  .sys-meter__fill[data-tone='mint'],
  .sys-cores__bar[data-tone='mint'] {
    background: var(--mint-bar);
  }

  .sys-meter__fill[data-tone='amber'],
  .sys-cores__bar[data-tone='amber'] {
    background: var(--amber);
  }

  .sys-meter__fill[data-tone='fault'],
  .sys-cores__bar[data-tone='fault'] {
    background: var(--fault);
  }

  /* Live 1s per-core spectrum bars (up to 16 even buckets, scaling cleanly across 2..256+ logical cores) */
  .sys-cores {
    width: 100%;
    height: 1rem;
    padding: 2px;
    border-radius: 0.25rem;
    background: var(--strip-well);
    box-shadow: inset 0 1px 1.5px rgb(0 0 0 / 0.22);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 1.5px;
    align-items: stretch;
  }

  .sys-cores__slot {
    display: flex;
    align-items: flex-end;
    height: 100%;
    background: rgb(128 128 128 / 0.06);
    border-radius: 1px;
    overflow: hidden;
  }

  .sys-cores__bar {
    width: 100%;
    height: 100%;
    transform-origin: center bottom;
    transform: scaleY(var(--core-fill, 0.1));
    transition: transform 180ms var(--ease-out);
  }

  /* Inline pill switcher for 2..3 mounted disks */
  .sys-disk-tabs {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    padding: 0.125rem;
    border-radius: 0.25rem;
    background: var(--strip-well);
    box-shadow: inset 0 1px 1.5px rgb(0 0 0 / 0.2);
  }

  .sys-disk-tab {
    position: relative;
    border: 0;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.1875rem;
    background: transparent;
    color: var(--ink-3);
    font-size: 0.6875rem;
    line-height: 1.3;
    white-space: nowrap;
    transition:
      color 0.12s,
      background-color 0.12s,
      box-shadow 0.12s;
  }

  .sys-disk-tab:hover {
    color: var(--ink-2);
  }

  .sys-disk-tab[data-warn='true'] {
    color: var(--fault);
  }

  .sys-disk-tab[aria-selected='true'] {
    background: var(--plate);
    color: var(--ink);
    font-weight: 650;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 1px 2px rgb(0 0 0 / 0.18);
  }

  .sys-disk-tab[aria-selected='true'][data-warn='true'] {
    color: var(--fault);
  }

  /* Compact native select wrapper for >=4 mounted disks */
  .sys-disk-select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: 0.25rem;
    background: var(--strip-well);
    box-shadow: inset 0 1px 1.5px rgb(0 0 0 / 0.2);
  }

  .sys-disk-select {
    appearance: none;
    height: 1.375rem;
    padding: 0 1.375rem 0 0.5rem;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    max-width: 10.5rem;
  }

  .sys-disk-select option {
    background: var(--chassis-deep);
    color: var(--ink);
  }

  .sys-disk-select__chevron {
    position: absolute;
    right: 0.3125rem;
    display: inline-flex;
    color: var(--ink-3);
    pointer-events: none;
  }

  @media (max-width: 1020px) {
    .sys-strip {
      grid-template-columns: minmax(0, 1fr);
      padding: 0.1875rem var(--gap);
    }

    .sys-bay {
      padding: 0.3125rem 0;
    }

    .sys-bay + .sys-bay {
      border-left: 0;
      border-top: 1px solid var(--hairline);
    }
  }
</style>
