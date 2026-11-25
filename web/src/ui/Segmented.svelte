<script lang="ts">
  import type { IconName } from '../icons/names';

  export interface SegmentedOption {
    value: string;
    label: string;
    icon?: IconName;
  }

  interface Props {
    value?: string;
    options: SegmentedOption[];
    ariaLabel: string;
    size?: 'sm' | 'md';
    onchange?: (value: string) => void;
  }

  let {
    value = $bindable(''),
    options,
    ariaLabel,
    size = 'md',
    onchange,
  }: Props = $props();

  let groupEl: HTMLDivElement | undefined = $state();

  function selectOption(next: string) {
    if (next === value) return;
    value = next;
    onchange?.(next);
  }

  function handleKeydown(e: KeyboardEvent, index: number) {
    if (options.length === 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (index + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIdx = (index - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = options.length - 1;
    }

    if (nextIdx >= 0) {
      e.preventDefault();
      const target = options[nextIdx];
      selectOption(target.value);
      const buttons = groupEl?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
      buttons?.[nextIdx]?.focus();
    }
  }
</script>

<div
  bind:this={groupEl}
  class="pk-segmented pk-segmented--{size}"
  role="radiogroup"
  aria-label={ariaLabel}
>
  {#each options as opt, idx (opt.value)}
    {@const active = opt.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={active ? 'true' : 'false'}
      tabindex={active ? 0 : -1}
      onclick={() => selectOption(opt.value)}
      onkeydown={(e) => handleKeydown(e, idx)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .pk-segmented {
    display: inline-flex;
    align-items: center;
    height: 2rem;
    padding: 0.1875rem;
    border-radius: var(--r-key);
    background: var(--glass);
    box-shadow:
      inset 0 0 0 1px var(--glass-edge),
      0 1px 0 var(--plate-hi);
  }

  .pk-segmented--md {
    height: 2.25rem;
  }

  .pk-segmented button {
    height: 100%;
    padding: 0 0.75rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--ink-2);
    font-size: 0.8125rem;
    white-space: nowrap;
    transition:
      background-color 0.14s,
      color 0.14s;
  }

  .pk-segmented--sm button {
    padding: 0 0.6875rem;
    font-size: 0.8125rem;
  }

  .pk-segmented button:hover {
    color: var(--ink);
  }

  .pk-segmented button[aria-checked='true'] {
    background: var(--plate-raised);
    color: var(--ink);
    font-weight: 500;
    box-shadow: inset 0 1px 0 var(--plate-hi);
  }
</style>
