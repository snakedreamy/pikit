<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    forId?: string;
    meta?: string;
    hint?: string;
    error?: string;
    row?: boolean;
    stretch?: boolean;
    children: Snippet;
  }

  let { label, forId, meta, hint, error, row = false, stretch = false, children }: Props = $props();
</script>

<div
  class="pk-field"
  data-row={row ? 'true' : undefined}
  data-stretch={stretch ? 'true' : undefined}
>
  <div class="pk-field__text">
    <div class="pk-field__head">
      {#if forId}
        <label class="pk-field__label" for={forId}>{label}</label>
      {:else}
        <span class="pk-field__label">{label}</span>
      {/if}
      {#if meta}
        <span class="pk-field__meta mono">{meta}</span>
      {/if}
    </div>

    {#if error}
      <p class="pk-field__error" role="alert">{error}</p>
    {:else if hint}
      <p class="pk-field__hint">{hint}</p>
    {/if}
  </div>

  <div class="pk-field__control">
    {@render children()}
  </div>
</div>

<style>
  .pk-field {
    display: flex;
    flex-direction: column;
    gap: 0.4375rem;
    min-width: 0;
  }

  .pk-field[data-row='true'] {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--groove);
  }

  .pk-field[data-row='true']:last-child {
    border-bottom: 0;
  }

  .pk-field__text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .pk-field__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .pk-field__label {
    font-size: 0.8125rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: var(--ink-2);
  }

  .pk-field[data-row='true'] .pk-field__label {
    font-size: 0.875rem;
    letter-spacing: 0;
    color: var(--ink);
  }

  .pk-field__meta {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .pk-field__hint {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--ink-3);
  }

  .pk-field__error {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--fault);
  }

  .pk-field[data-row='true'] .pk-field__control {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .pk-field[data-stretch='true'] {
    height: 100%;
  }

  .pk-field[data-stretch='true'] .pk-field__control {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
</style>
