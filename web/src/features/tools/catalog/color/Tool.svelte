<script lang="ts">
  import { cssVars } from '../../../../lib/actions/cssVars';
  import { t } from '../../../../lib/i18n/index.svelte';
  import { CopyButton, Field, Input } from '../../../../ui';
  import { parseColorString } from './logic';

  const NS = 'tool:color';

  let raw = $state('#f6b032');
  const parsed = $derived(parseColorString(raw));
</script>

<div class="col-bench">
  <div class="col-top">
    <div class="col-top__field">
      <Field
        label={t('inputLabel', undefined, NS)}
        forId="pk-col-in"
        error={raw.trim() && !parsed ? t('invalid', undefined, NS) : undefined}
      >
        <Input id="pk-col-in" bind:value={raw} mono invalid={Boolean(raw.trim() && !parsed)} />
      </Field>
    </div>

    <label class="glass col-swatch-wrap" title={t('pickerLabel', undefined, NS)}>
      <span
        class="col-swatch"
        use:cssVars={{ 'swatch-bg': parsed ? parsed.hex : 'transparent' }}
      ></span>
      <input
        type="color"
        value={parsed ? parsed.hex : '#f6b032'}
        oninput={(e) => (raw = (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  </div>

  {#if parsed}
    {@const formats = [
      { name: 'HEX', val: parsed.hex },
      { name: 'RGB', val: parsed.rgb },
      { name: 'HSL', val: parsed.hsl },
      { name: 'OKLCH', val: parsed.oklch },
    ]}
    <dl class="glass col-table">
      {#each formats as fmt (fmt.name)}
        <div class="col-row">
          <dt class="mono">{fmt.name}</dt>
          <dd class="mono">{fmt.val}</dd>
          <CopyButton text={fmt.val} />
        </div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .col-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .col-top {
    display: flex;
    align-items: flex-end;
    gap: 0.875rem;
  }

  .col-top__field {
    flex: 1;
    min-width: 0;
  }

  .col-swatch-wrap {
    position: relative;
    width: 4.5rem;
    height: 2.375rem;
    padding: 0.25rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .col-swatch {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 0.25rem;
    background-color: var(--swatch-bg, transparent);
  }

  .col-swatch-wrap input[type='color'] {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  .col-table {
    margin: 0;
    padding: 0.25rem 0.875rem;
  }

  .col-row {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0;
  }

  .col-row + .col-row {
    border-top: 1px solid var(--hairline);
  }

  .col-row dt {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .col-row dd {
    font-size: 0.875rem;
    color: var(--mint);
  }
</style>
