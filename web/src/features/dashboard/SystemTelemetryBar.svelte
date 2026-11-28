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

  function formatUsagePair(usedBytes: number, totalBytes: number): string {
    const usedText = formatBytes(usedBytes);
    const totalText = formatBytes(totalBytes);
    const usedParts = usedText.split(' ');
    const totalParts = totalText.split(' ');
    if (
      usedParts.length === 2 &&
      totalParts.length === 2 &&
      usedParts[1] === totalParts[1]
    ) {
      return `${usedParts[0]} / ${totalText}`;
    }
    return `${usedText} / ${totalText}`;
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
    parts.push(formatUsagePair(d.usedBytes, d.totalBytes));
    return parts.join(' · ');
  }
</script>

{#if snapshot && visibleColumns > 0}
  <section
    class="screen sys-strip"
    data-cols={visibleColumns}
    aria-label={t('telemetryAria', undefined, 'dashboard')}
  >
    {#if snapshot.cpu}
      {@const cpu = snapshot.cpu}
      {@const cpuTone = toneForPercent(cpu.percent)}
      <div class="sys-bay">
        <div class="sys-bay__lead">
          <span class="sys-bay__icon" data-tone={cpuTone} aria-hidden="true">
            <Icon name="cpu" size="xs" />
          </span>
          <b>{t('cpu', undefined, 'dashboard')}</b>
          <span class="sys-bay__sub mono">
            {cpu.usedCoresText
              ? `${cpu.usedCoresText} / ${t('cores', { count: cpu.totalCores }, 'dashboard')}`
              : t('cores', { count: cpu.totalCores }, 'dashboard')}
          </span>
        </div>

        <div class="sys-bay__gauge">
          {#if coreBuckets.length > 0}
            <div class="sys-cores" role="img" aria-label={fmtPct(cpu.percent)}>
              {#each coreBuckets as bucket (bucket.startIndex)}
                <i
                  class="sys-cores__bar"
                  data-tone={toneForPercent(bucket.percent)}
                  title={formatCoreBucketTooltip(bucket)}
                  use:cssVars={{
                    'core-h': `${Math.max(11, Math.round(clampRatio(bucket.percent) * 100))}%`,
                  }}
                ></i>
              {/each}
            </div>
          {:else}
            <div class="sys-meter">
              <span
                class="sys-meter__fill"
                data-tone={cpuTone}
                use:cssVars={{ 'bar-fill': clampRatio(cpu.percent).toFixed(4) }}
              ></span>
            </div>
          {/if}
        </div>

        <output
          class="mono sys-bay__val"
          data-tone={cpuTone}
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
      {@const memTone = toneForPercent(mem.percent)}
      <div class="sys-bay">
        <div class="sys-bay__lead">
          <span class="sys-bay__icon" data-tone={memTone} aria-hidden="true">
            <Icon name="memory-stick" size="xs" />
          </span>
          <b>{t('memory', undefined, 'dashboard')}</b>
          <span class="sys-bay__sub mono">
            {formatUsagePair(mem.usedBytes, mem.totalBytes)}
          </span>
        </div>

        <div class="sys-bay__gauge sys-bay__gauge--wide">
          <div class="sys-meter">
            <span
              class="sys-meter__fill"
              data-tone={memTone}
              use:cssVars={{ 'bar-fill': clampRatio(mem.percent).toFixed(4) }}
            ></span>
          </div>
        </div>

        <output
          class="mono sys-bay__val"
          data-tone={memTone}
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
            <span class="sys-bay__sub mono" title={formatDiskTooltip(activeDisk)}>
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
            {formatUsagePair(activeDisk.usedBytes, activeDisk.totalBytes)}
          </span>
        {/if}

        <div class="sys-bay__gauge sys-bay__gauge--disk">
          <div class="sys-meter">
            <span
              class="sys-meter__fill"
              data-tone={diskTone}
              use:cssVars={{
                'bar-fill': activeDisk.error ? '0' : clampRatio(activeDisk.percent).toFixed(4),
              }}
            ></span>
          </div>
        </div>

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
{/if}

<style>
  .sys-strip {
    width: 100%;
    margin-top: 0.25rem;
    min-height: 3.25rem;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
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
    gap: 0.625rem;
    padding: 0.5rem 1.1875rem;
    min-width: 0;
  }

  .sys-bay + .sys-bay {
    box-shadow: inset 1px 0 0 var(--screen-line);
  }

  .sys-bay__lead {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
  }

  .sys-bay__icon {
    display: inline-flex;
    color: var(--screen-mint);
    flex-shrink: 0;
  }

  .sys-bay__icon[data-tone='amber'] {
    color: var(--screen-amber);
  }

  .sys-bay__icon[data-tone='fault'] {
    color: var(--fault);
  }

  .sys-bay__lead b {
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--screen-ink);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .sys-bay__sub {
    font-size: 0.75rem;
    font-stretch: 82%;
    color: var(--screen-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sys-bay__cap {
    font-size: 0.71875rem;
    font-stretch: 82%;
    color: var(--screen-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 0 1 auto;
  }

  .sys-bay__gauge {
    flex: 1 1 3rem;
    min-width: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-left: auto;
  }

  .sys-bay__gauge--wide .sys-meter {
    max-width: 9.75rem;
  }

  .sys-bay__gauge--disk {
    flex: 1 0 3.25rem;
    min-width: 3.25rem;
    max-width: 5.5rem;
  }

  .sys-bay__val {
    flex: 0 0 auto;
    min-width: 3.5rem;
    text-align: right;
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--screen-ink);
  }

  .sys-bay__val[data-tone='amber'] {
    color: var(--screen-amber);
  }

  .sys-bay__val[data-tone='fault'] {
    color: var(--fault);
  }

  /* Free-standing per-core load spectrum bars (no background slot box clutter) */
  .sys-cores {
    height: 1.375rem;
    display: inline-flex;
    align-items: flex-end;
    gap: 3px;
    max-width: 100%;
  }

  .sys-cores__bar {
    display: block;
    width: 0.4375rem;
    min-width: 3px;
    flex: 0 1 0.4375rem;
    height: var(--core-h, 12%);
    min-height: 2.5px;
    border-radius: 1.25px;
    background: var(--screen-mint);
    box-shadow: 0 0 0.35rem var(--mint-glow);
    transition:
      height 180ms var(--ease-out),
      background-color 180ms var(--ease-out);
  }

  .sys-cores__bar[data-tone='amber'] {
    background: var(--screen-amber);
    box-shadow: 0 0 0.35rem var(--amber-glow);
  }

  .sys-cores__bar[data-tone='fault'] {
    background: var(--fault);
    box-shadow: 0 0 0.35rem var(--fault-glow);
  }

  /* Sleek continuous meter bar */
  .sys-meter {
    position: relative;
    width: 100%;
    height: 0.375rem;
    border-radius: 0.1875rem;
    background: var(--screen-dot);
    overflow: hidden;
  }

  .sys-meter__fill {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 0.1875rem;
    background: var(--screen-mint);
    box-shadow: 0 0 0.45rem var(--mint-glow);
    transform-origin: left center;
    transform: scaleX(var(--bar-fill, 0));
    transition: transform 180ms var(--ease-out);
  }

  .sys-meter__fill[data-tone='amber'] {
    background: var(--screen-amber);
    box-shadow: 0 0 0.45rem var(--amber-glow);
  }

  .sys-meter__fill[data-tone='fault'] {
    background: var(--fault);
    box-shadow: 0 0 0.45rem var(--fault-glow);
  }

  .sys-disk-tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .sys-disk-tab {
    border: 0;
    padding: 0.15625rem 0.4375rem;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--screen-ink-2);
    font-size: 0.6875rem;
    font-stretch: 82%;
    font-weight: 500;
    line-height: 1.25;
    white-space: nowrap;
    transition:
      color 0.12s,
      background-color 0.12s;
  }

  .sys-disk-tab:hover {
    color: var(--screen-ink);
  }

  .sys-disk-tab[data-warn='true'] {
    color: var(--fault);
  }

  .sys-disk-tab[aria-selected='true'] {
    background: var(--screen-dot);
    color: var(--screen-ink);
    font-weight: 650;
  }

  .sys-disk-tab[aria-selected='true'][data-warn='true'] {
    color: var(--fault);
  }

  .sys-disk-select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: 0.25rem;
    background: var(--screen-dot);
    flex-shrink: 0;
  }

  .sys-disk-select {
    appearance: none;
    height: 1.375rem;
    padding: 0 1.25rem 0 0.4375rem;
    border: 0;
    background: transparent;
    color: var(--screen-ink);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    max-width: 8.5rem;
  }

  .sys-disk-select option {
    background: var(--chassis-deep);
    color: var(--ink);
  }

  .sys-disk-select__chevron {
    position: absolute;
    right: 0.25rem;
    display: inline-flex;
    color: var(--screen-ink-2);
    pointer-events: none;
  }

  @media (max-width: 1360px) {
    .sys-bay__cap {
      display: none;
    }
  }

  @media (max-width: 1020px) {
    .sys-strip {
      grid-template-columns: minmax(0, 1fr);
    }

    .sys-bay {
      padding: 0.5rem 1rem;
    }

    .sys-bay + .sys-bay {
      box-shadow: inset 0 1px 0 var(--screen-line);
    }
  }
</style>
