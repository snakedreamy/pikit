<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons/names';
  import Icon from './Icon.svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    icon?: IconName;
    trailingIcon?: IconName;
    loading?: boolean;
    disabled?: boolean;
    fullWidth?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    type = 'button',
    icon,
    trailingIcon,
    loading = false,
    disabled = false,
    fullWidth = false,
    onclick,
    children,
  }: Props = $props();

  const isDisabled = $derived(disabled || loading);
</script>

<button
  {type}
  class="pk-key pk-key--{variant} pk-key--{size}"
  class:pk-key--full={fullWidth}
  disabled={isDisabled}
  aria-busy={loading ? 'true' : undefined}
  {onclick}
>
  {#if loading}
    <span class="pk-key__spinner" aria-hidden="true"></span>
  {:else if icon}
    <Icon name={icon} size="sm" />
  {/if}
  <span>{@render children()}</span>
  {#if trailingIcon && !loading}
    <Icon name={trailingIcon} size="xs" />
  {/if}
</button>

<style>
  .pk-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4375rem;
    border: 0;
    border-radius: var(--r-key);
    background: var(--plate);
    color: var(--ink);
    font-weight: 550;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1.5px 0 var(--plate-side),
      0 3px 8px -4px rgb(0 0 0 / 0.25);
    transition:
      transform 0.1s var(--ease-out),
      box-shadow 0.1s var(--ease-out),
      background-color 0.14s,
      color 0.14s;
  }

  .pk-key--full {
    width: 100%;
  }

  .pk-key--sm {
    height: 2.125rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
  }
  .pk-key--md {
    height: 2.3125rem;
    padding: 0 0.9375rem;
    font-size: 0.875rem;
  }
  .pk-key--lg {
    height: 2.625rem;
    padding: 0 1.25rem;
    font-size: 0.9375rem;
  }

  .pk-key--secondary:hover:not(:disabled) {
    background: var(--plate-raised);
  }

  .pk-key--primary {
    background: var(--amber);
    color: var(--ink-on-amber);
    font-weight: 700;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.35),
      0 2px 0 var(--amber-bevel),
      0 8px 16px -6px rgb(0 0 0 / 0.36);
  }
  .pk-key--primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--amber), white 10%);
  }

  .pk-key--ghost {
    background: transparent;
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .pk-key--ghost:hover:not(:disabled) {
    color: var(--ink);
    background: var(--groove);
  }

  .pk-key--danger {
    background: var(--plate-raised);
    color: var(--fault);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1.5px 0 var(--plate-side);
  }
  .pk-key--danger:hover:not(:disabled) {
    background: var(--fault);
    color: #fff;
  }

  .pk-key:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 0.5px 0 var(--plate-side);
  }

  .pk-key--primary:active:not(:disabled) {
    transform: translateY(1.5px);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.35),
      0 0.5px 0 var(--amber-bevel);
  }

  .pk-key:disabled {
    background: var(--well);
    color: var(--ink-3);
    font-weight: 550;
    box-shadow: inset 0 0 0 1px var(--hairline);
    opacity: 0.78;
    cursor: not-allowed;
  }

  .pk-key__spinner {
    width: 0.8125rem;
    height: 0.8125rem;
    border: 1.75px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: pk-spin 650ms linear infinite;
  }

  @keyframes pk-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
