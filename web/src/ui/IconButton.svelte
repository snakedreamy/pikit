<script lang="ts">
  import type { IconName } from '../icons/names';
  import Icon from './Icon.svelte';

  interface Props {
    icon: IconName;
    label: string;
    variant?: 'ghost' | 'secondary' | 'danger';
    size?: 'sm' | 'md';
    active?: boolean;
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    icon,
    label,
    variant = 'secondary',
    size = 'md',
    active = false,
    disabled = false,
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class="pk-ikey pk-ikey--{variant} pk-ikey--{size}"
  aria-label={label}
  aria-pressed={active ? 'true' : undefined}
  {disabled}
  {onclick}
>
  <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
</button>

<style>
  .pk-ikey {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--r-key);
    padding: 0;
    flex: none;
    background: var(--plate-raised);
    color: var(--ink);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 2px 0 var(--plate-lo);
    transition:
      transform 0.08s,
      box-shadow 0.08s,
      background-color 0.15s;
  }

  .pk-ikey--sm {
    width: 1.875rem;
    height: 1.875rem;
  }
  .pk-ikey--md {
    width: 2.25rem;
    height: 2.25rem;
  }

  .pk-ikey--ghost {
    background: transparent;
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--plate-hi);
  }
  .pk-ikey--ghost:hover:not(:disabled) {
    color: var(--ink);
  }

  .pk-ikey--secondary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--plate-raised), var(--ink) 8%);
  }

  .pk-ikey--danger {
    background: var(--fault-soft);
    color: var(--fault);
  }

  .pk-ikey[aria-pressed='true'] {
    background: var(--glass);
    color: var(--amber);
    box-shadow:
      inset 0 0 0 1px var(--glass-edge),
      0 1px 0 var(--plate-hi);
  }

  .pk-ikey:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: inset 0 1px 0 var(--plate-hi);
  }

  .pk-ikey:disabled {
    color: var(--ink-3);
    cursor: not-allowed;
  }
</style>
