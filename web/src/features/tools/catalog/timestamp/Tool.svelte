<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, CopyButton, Field, Input } from '../../../../ui';
  import { parseFlexibleTimestamp } from './logic';

  const NS = 'tool:timestamp';

  let raw = $state(String(Math.floor(Date.now() / 1000)));
  const parsed = $derived(parseFlexibleTimestamp(raw));
</script>

<div class="ts-bench">
  <div class="ts-bench__top">
    <div class="ts-bench__input">
      <Field
        label={t('inputLabel', undefined, NS)}
        forId="pk-ts-in"
        error={raw.trim() && !parsed ? t('invalid', undefined, NS) : undefined}
      >
        <Input id="pk-ts-in" bind:value={raw} mono invalid={Boolean(raw.trim() && !parsed)} />
      </Field>
    </div>
    <Button variant="secondary" onclick={() => (raw = String(Date.now()))}>
      {t('useNow', undefined, NS)}
    </Button>
  </div>

  {#if parsed}
    <dl class="glass ts-table">
      <div class="ts-row">
        <dt>{t('rowSec', undefined, NS)}</dt>
        <dd class="mono">{parsed.epochSec}</dd>
        <CopyButton text={String(parsed.epochSec)} />
      </div>
      <div class="ts-row">
        <dt>{t('rowMs', undefined, NS)}</dt>
        <dd class="mono">{parsed.epochMs}</dd>
        <CopyButton text={String(parsed.epochMs)} />
      </div>
      <div class="ts-row">
        <dt>{t('rowLocal', { tz: parsed.localTimeZone }, NS)}</dt>
        <dd class="mono ts-row__hi">{parsed.localString}</dd>
        <CopyButton text={parsed.localString} />
      </div>
      <div class="ts-row">
        <dt>{t('rowIso', undefined, NS)}</dt>
        <dd class="mono">{parsed.isoUtc}</dd>
        <CopyButton text={parsed.isoUtc} />
      </div>
      <div class="ts-row">
        <dt>{t('rowUtc', undefined, NS)}</dt>
        <dd class="mono">{parsed.utcString}</dd>
        <CopyButton text={parsed.utcString} />
      </div>
    </dl>
  {/if}
</div>

<style>
  .ts-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .ts-bench__top {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .ts-bench__input {
    flex: 1;
    min-width: 16rem;
  }

  .ts-table {
    margin: 0;
    padding: 0.25rem 0.875rem;
  }

  .ts-row {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0;
  }

  .ts-row + .ts-row {
    border-top: 1px solid var(--hairline);
  }

  .ts-row dt {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .ts-row dd {
    font-size: 0.875rem;
    color: var(--ink);
    overflow-x: auto;
  }

  .ts-row__hi {
    color: var(--mint) !important;
    font-weight: 600;
  }

  @media (max-width: 680px) {
    .ts-row {
      grid-template-columns: 1fr auto;
    }
    .ts-row dd {
      grid-column: 1 / -1;
      order: 3;
    }
  }
</style>
