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
    background: var(--plate-raised);
    color: var(--ink);
    font-weight: 550;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 1.5px 0 var(--key-bevel),
      0 2px 5px rgb(0 0 0 / 0.2);
    transition:
      transform 0.08s,
      box-shadow 0.08s,
      background-color 0.14s;
  }

  .pk-key--full {
    width: 100%;
  }

  .pk-key--sm {
    height: 2rem;
    padding: 0 0.6875rem;
    font-size: 0.8125rem;
  }
  .pk-key--md {
    height: 2.1875rem;
    padding: 0 0.875rem;
    font-size: 0.84375rem;
  }
  .pk-key--lg {
    height: 2.4375rem;
    padding: 0 1.125rem;
    font-size: 0.9375rem;
  }

  .pk-key--secondary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--plate-raised), var(--ink) 8%);
  }

  .pk-key--primary {
    background: var(--amber);
    color: var(--ink-on-amber);
    font-weight: 600;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.38),
      0 2px 0 var(--amber-bevel);
  }
  .pk-key--primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--amber), white 12%);
  }

  .pk-key--ghost {
    background: transparent;
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--plate-hi);
  }
  .pk-key--ghost:hover:not(:disabled) {
    color: var(--ink);
    background: rgb(255 255 255 / 0.04);
  }

  .pk-key--danger {
    background: var(--fault-soft);
    color: var(--fault);
    box-shadow:
      inset 0 0 0 1px rgb(255 112 89 / 0.36),
      0 2px 0 var(--plate-lo);
  }
  .pk-key--danger:hover:not(:disabled) {
    background: var(--fault);
    color: #fff;
  }

  .pk-key:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: inset 0 1px 0 var(--plate-hi);
  }

  .pk-key:disabled {
    color: var(--ink-3);
    opacity: 0.6;
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
