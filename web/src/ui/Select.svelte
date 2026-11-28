<script lang="ts">
  import Icon from './Icon.svelte';

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    value?: string;
    options: SelectOption[];
    id?: string;
    name?: string;
    ariaLabel?: string;
    inline?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    onchange?: (value: string) => void;
  }

  let {
    value = $bindable(''),
    options,
    id,
    name,
    ariaLabel,
    inline = false,
    disabled = false,
    invalid = false,
    onchange,
  }: Props = $props();

  function handleChange(e: Event) {
    const next = (e.currentTarget as HTMLSelectElement).value;
    value = next;
    onchange?.(next);
  }
</script>

<div class="pk-select-wrap" data-inline={inline ? 'true' : undefined}>
  <select
    {id}
    name={name ?? id ?? ariaLabel}
    class="pk-select"
    {value}
    {disabled}
    aria-label={ariaLabel}
    aria-invalid={invalid ? 'true' : undefined}
    onchange={handleChange}
  >
    {#each options as opt (opt.value)}
      <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
    {/each}
  </select>
  <span class="pk-select__chevron" aria-hidden="true">
    <Icon name="chevron-down" size="xs" />
  </span>
</div>

<style>
  .pk-select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 100%;
  }

  .pk-select-wrap[data-inline='true'] {
    width: auto;
  }

  .pk-select {
    appearance: none;
    width: 100%;
    height: 2.25rem;
    padding: 0 2rem 0 0.75rem;
    border: 0;
    border-radius: var(--r-key);
    background: var(--plate);
    color: var(--ink);
    font-size: 0.84375rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo);
    transition:
      color 0.14s,
      background-color 0.14s,
      transform 0.1s;
  }

  .pk-select:hover:not(:disabled) {
    background: var(--plate-raised);
  }

  .pk-select-wrap[data-inline='true'] .pk-select {
    width: auto;
    height: 2.25rem;
    padding: 0 1.875rem 0 0.75rem;
    color: var(--ink-2);
  }

  .pk-select-wrap[data-inline='true']:hover .pk-select {
    color: var(--ink);
  }

  .pk-select option {
    background: var(--chassis-deep);
    color: var(--ink);
  }

  .pk-select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .pk-select__chevron {
    position: absolute;
    right: 0.5625rem;
    display: inline-flex;
    color: var(--ink-3);
    pointer-events: none;
  }
</style>
