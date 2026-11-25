<script lang="ts">
  import type { IconName } from '../icons/names';
  import { cssVars } from '../lib/actions/cssVars';

  export type MeterTone = 'auto' | 'accent' | 'success' | 'warning' | 'danger';

  interface Props {
    label: string;
    valueText: string;
    percent: number;
    detail?: string;
    sourceTip?: string;
    icon?: IconName;
    tone?: MeterTone;
  }

  let {
    label,
    valueText,
    percent,
    detail,
    sourceTip,
    tone = 'auto',
  }: Props = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)));
  const ratio = $derived((clamped / 100).toFixed(4));

  const resolvedTone = $derived.by(() => {
    if (tone !== 'auto') return tone;
    if (clamped >= 90) return 'danger';
    if (clamped >= 75) return 'warning';
    return 'success';
  });

  const noteText = $derived([detail, sourceTip].filter(Boolean).join(' · '));
</script>

<div class="pk-meter" use:cssVars={{ 'meter-ratio': ratio }}>
  <div class="pk-meter__head">
    <div class="legend">
      <span>{label}</span>
      {#if noteText}
        <span class="legend__note">{noteText}</span>
      {/if}
    </div>
    <span class="pk-meter__val mono">{valueText}</span>
  </div>

  <div
    class="glass pk-meter__track"
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(clamped)}
    aria-valuetext={valueText}
  >
    <div class="pk-meter__fill pk-meter__fill--{resolvedTone}"></div>
    <div class="pk-meter__ticks" aria-hidden="true"></div>
  </div>
</div>

<style>
  .pk-meter {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .pk-meter__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.625rem;
    min-width: 0;
  }

  .pk-meter__head .legend {
    min-width: 0;
    overflow: hidden;
  }

  .pk-meter__val {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
    flex: none;
  }

  .pk-meter__track {
    position: relative;
    height: 0.8125rem;
    border-radius: 0.25rem;
    overflow: hidden;
  }

  /* Symmetric inset + scaleX keeps 0%..100% pixel-aligned with the decile tick marks */
  .pk-meter__fill {
    position: absolute;
    inset: 0.1875rem;
    border-radius: 0.125rem;
    transform: scaleX(var(--meter-ratio, 0));
    transform-origin: left center;
    transition: transform var(--dur-normal) var(--ease-out);
  }

  .pk-meter__fill--success {
    background: var(--mint);
  }
  .pk-meter__fill--accent,
  .pk-meter__fill--warning {
    background: var(--amber);
  }
  .pk-meter__fill--danger {
    background: var(--fault);
  }

  /* 9 internal decile tick marks (10%..90%) without a trailing line at 100% */
  .pk-meter__ticks {
    position: absolute;
    inset: 0.1875rem;
    background-image: repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1.5px),
      var(--glass) calc(10% - 1.5px),
      var(--glass) 10%
    );
    background-size: 100.15% 100%;
    pointer-events: none;
  }
</style>
