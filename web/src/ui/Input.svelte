<script lang="ts">
  import type { IconName } from '../icons/names';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    value?: string;
    id?: string;
    type?: 'text' | 'search' | 'number' | 'password' | 'url';
    placeholder?: string;
    icon?: IconName;
    mono?: boolean;
    invalid?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    clearable?: boolean;
    autocomplete?: AutoFill;
    oninput?: (e: Event) => void;
    onkeydown?: (e: KeyboardEvent) => void;
  }

  let {
    value = $bindable(''),
    id,
    type = 'text',
    placeholder = '',
    icon,
    mono = false,
    invalid = false,
    disabled = false,
    readonly = false,
    clearable = false,
    autocomplete = 'off',
    oninput,
    onkeydown,
  }: Props = $props();

  function clear() {
    value = '';
  }
</script>

<div
  class="glass pk-input-wrap"
  data-invalid={invalid ? 'true' : undefined}
  data-disabled={disabled ? 'true' : undefined}
>
  {#if icon}
    <span class="pk-input__icon" aria-hidden="true">
      <Icon name={icon} size="sm" />
    </span>
  {/if}
  <input
    {id}
    {type}
    class="pk-input"
    class:mono
    bind:value
    {placeholder}
    {disabled}
    {readonly}
    {autocomplete}
    spellcheck={mono ? 'false' : undefined}
    aria-invalid={invalid ? 'true' : undefined}
    {oninput}
    {onkeydown}
  />
  {#if clearable && value && !disabled && !readonly}
    <button
      type="button"
      class="pk-input__clear"
      aria-label={t('common.clear')}
      onclick={clear}
    >
      <Icon name="x" size="xs" />
    </button>
  {/if}
</div>

<style>
  .pk-input-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.1875rem;
    padding: 0 0.6875rem;
  }

  .pk-input-wrap[data-invalid='true'] {
    box-shadow:
      inset 0 0 0 1px var(--fault),
      inset 0 2px 5px var(--glass-shadow);
  }

  .pk-input-wrap:focus-within {
    outline: 2px solid var(--mint);
    outline-offset: 1px;
  }

  .pk-input-wrap[data-disabled='true'] {
    opacity: 0.55;
  }

  .pk-input__icon {
    display: inline-flex;
    color: var(--ink-3);
    flex: none;
  }

  .pk-input {
    flex: 1;
    min-width: 0;
    height: 2.125rem;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ink);
    font-size: 0.875rem;
  }

  .pk-input.mono {
    font-size: 0.8125rem;
    color: var(--mint);
  }

  .pk-input:focus,
  .pk-input:focus-visible {
    outline: none;
  }

  .pk-input::placeholder {
    color: var(--ink-3);
  }

  .pk-input__clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border: 0;
    padding: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--ink-3);
  }
  .pk-input__clear:hover {
    color: var(--ink);
  }
</style>
