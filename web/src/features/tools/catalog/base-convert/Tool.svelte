<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { CopyButton, Field, Input, Select } from '../../../../ui';
  import { formatBigIntInBase, parseBigIntInBase } from './logic';

  const NS = 'tool:base-convert';

  let raw = $state('255');
  let inBase = $state('10');
  let customOutBase = $state('36');

  const baseOptions = Array.from({ length: 35 }, (_, i) => {
    const b = String(i + 2);
    return { value: b, label: `Base ${b}` };
  });

  const parsed = $derived(parseBigIntInBase(raw, Number(inBase)));
  const outCustomRadix = $derived(Math.min(36, Math.max(2, Number(customOutBase) || 36)));
</script>

<div class="bc-bench">
  <div class="bc-top">
    <Field
      label={t('inputLabel', undefined, NS)}
      forId="pk-bc-val"
      error={raw.trim() && parsed === null ? t('invalid', undefined, NS) : undefined}
    >
      <Input id="pk-bc-val" bind:value={raw} mono invalid={Boolean(raw.trim() && parsed === null)} />
    </Field>

    <Field label={t('sourceBase', undefined, NS)} forId="pk-bc-inbase">
      <Select id="pk-bc-inbase" bind:value={inBase} options={baseOptions} />
    </Field>

    <Field label={t('customBase', undefined, NS)} forId="pk-bc-outbase">
      <Select id="pk-bc-outbase" bind:value={customOutBase} options={baseOptions} />
    </Field>
  </div>

  {#if parsed !== null}
    {@const rows = [
      { label: t('bin', undefined, NS), val: formatBigIntInBase(parsed, 2) },
      { label: t('oct', undefined, NS), val: formatBigIntInBase(parsed, 8) },
      { label: t('dec', undefined, NS), val: formatBigIntInBase(parsed, 10) },
      { label: t('hex', undefined, NS), val: formatBigIntInBase(parsed, 16) },
      {
        label: t('customOut', { base: outCustomRadix }, NS),
        val: formatBigIntInBase(parsed, outCustomRadix),
      },
    ]}
    <dl class="glass bc-table">
      {#each rows as row (row.label)}
        <div class="bc-row">
          <dt>{row.label}</dt>
          <dd class="mono">{row.val}</dd>
          <CopyButton text={row.val} />
        </div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .bc-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .bc-top {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(9rem, 1fr) minmax(9rem, 1fr);
    gap: 0.875rem;
    align-items: start;
  }

  .bc-table {
    margin: 0;
    padding: 0.25rem 0.875rem;
  }

  .bc-row {
    display: grid;
    grid-template-columns: 11rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0;
  }

  .bc-row + .bc-row {
    border-top: 1px solid var(--hairline);
  }

  .bc-row dt {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .bc-row dd {
    font-size: 0.875rem;
    color: var(--mint);
    word-break: break-all;
  }

  @media (max-width: 760px) {
    .bc-top {
      grid-template-columns: minmax(0, 1fr);
    }
    .bc-row {
      grid-template-columns: 1fr auto;
    }
    .bc-row dd {
      grid-column: 1 / -1;
      order: 3;
    }
  }
</style>
