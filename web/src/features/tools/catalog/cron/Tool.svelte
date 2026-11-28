<script lang="ts">
  import { getLocale, t } from '../../../../lib/i18n/index.svelte';
  import { Button, CopyButton, Field, Input } from '../../../../ui';
  import {
    computeNextCronRuns,
    CRON_LOOKAHEAD_YEARS,
    describeCron,
    formatLocalDateTimeWithOffset,
    parseCronExpression,
  } from './logic';

  const NS = 'tool:cron';
  const RUN_COUNT = 8;
  const PRESETS = [
    '*/5 * * * *',
    '0 3 * * *',
    '30 9 * * 1-5',
    '0 0 1 * *',
    '*/15 * * * * *',
  ] as const;

  let expr = $state('30 9 * * 1-5');
  const locale = $derived(getLocale());
  const parsed = $derived(parseCronExpression(expr));

  const upcoming = $derived.by(() => {
    if (!parsed.ok) return [];
    return computeNextCronRuns(parsed.cron, RUN_COUNT, new Date());
  });

  const fieldSlots = $derived.by(() => {
    if (!parsed.ok) return [];
    const c = parsed.cron;
    const base = [
      { label: t('minField', undefined, NS), val: c.min.raw },
      { label: t('hourField', undefined, NS), val: c.hour.raw },
      { label: t('domField', undefined, NS), val: c.dom.raw },
      { label: t('monField', undefined, NS), val: c.mon.raw },
      { label: t('dowField', undefined, NS), val: c.dow.raw },
    ];
    return c.hasSeconds
      ? [{ label: t('secField', undefined, NS), val: c.sec.raw }, ...base]
      : base;
  });
</script>

<div class="cr-bench">
  <Field
    label={t('inputLabel', undefined, NS)}
    forId="pk-cron-in"
    error={!parsed.ok ? parsed.error : undefined}
  >
    <Input
      id="pk-cron-in"
      bind:value={expr}
      mono
      invalid={!parsed.ok}
    />
  </Field>

  <div class="cr-presets">
    <span class="cr-presets__label">{t('presetsLabel', undefined, NS)}:</span>
    {#each PRESETS as preset (preset)}
      <Button variant="secondary" size="sm" onclick={() => (expr = preset)}>
        <span class="mono">{preset}</span>
      </Button>
    {/each}
  </div>

  {#if parsed.ok}
    <div class="glass cr-summary">
      <div class="cr-summary__text">
        <span class="cr-label">{t('summaryLabel', undefined, NS)}</span>
        <strong>{describeCron(parsed.cron, locale)}</strong>
      </div>
      <div class="cr-slots">
        {#each fieldSlots as slot (slot.label)}
          <div class="cr-slot">
            <span class="cr-slot__val mono">{slot.val}</span>
            <span class="cr-slot__name">{slot.label}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="cr-runs">
      <span class="cr-label">
        {upcoming.length > 0 && upcoming.length < RUN_COUNT
          ? t('nextRunsPartialLabel', { found: upcoming.length, years: CRON_LOOKAHEAD_YEARS }, NS)
          : t('nextRunsLabel', { count: RUN_COUNT }, NS)}
      </span>
      {#if upcoming.length === 0}
        <p class="glass cr-empty">{t('noUpcoming', { years: CRON_LOOKAHEAD_YEARS }, NS)}</p>
      {:else}
        <ol class="glass cr-list mono">
          {#each upcoming as dt, idx (dt.getTime())}
            {@const formatted = formatLocalDateTimeWithOffset(dt)}
            <li class="cr-item">
              <span class="cr-item__idx">#{idx + 1}</span>
              <span class="cr-item__ts">{formatted}</span>
              <CopyButton text={formatted} />
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cr-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .cr-presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4375rem;
  }

  .cr-presets__label {
    font-size: 0.75rem;
    color: var(--ink-3);
    margin-right: 0.25rem;
  }

  .cr-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .cr-summary {
    padding: 0.875rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .cr-summary__text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .cr-summary__text strong {
    font-size: 0.9375rem;
    color: var(--amber);
  }

  .cr-slots {
    display: flex;
    gap: 0.4375rem;
    flex-wrap: wrap;
  }

  .cr-slot {
    min-width: 3.25rem;
    padding: 0.375rem 0.5rem;
    border-radius: 0.3125rem;
    background: var(--plate);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }

  .cr-slot__val {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--mint);
  }

  .cr-slot__name {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .cr-runs {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cr-empty {
    padding: 1rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  .cr-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0.875rem;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1.5rem;
  }

  .cr-item {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 0.8125rem;
  }

  .cr-item__idx {
    color: var(--ink-3);
    font-size: 0.75rem;
  }

  .cr-item__ts {
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 860px) {
    .cr-list {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
