<script lang="ts">
  import type { Snippet } from 'svelte';

  export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

  interface Props {
    tone?: BadgeTone;
    dot?: boolean;
    mono?: boolean;
    children: Snippet;
  }

  let { tone = 'neutral', dot = false, mono = false, children }: Props = $props();

  const lampColor = $derived.by(() => {
    if (tone === 'success' || tone === 'info') return 'mint';
    if (tone === 'warning' || tone === 'accent') return 'amber';
    if (tone === 'danger') return 'fault';
    return 'dim';
  });
</script>

<span class="pk-badge pk-badge--{tone}" class:mono>
  {#if dot}
    <span class="lamp" data-color={lampColor} aria-hidden="true"></span>
  {/if}
  <span>{@render children()}</span>
</span>

<style>
  .pk-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    background: var(--groove);
    color: var(--ink-2);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.35;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .pk-badge--accent,
  .pk-badge--warning {
    background: var(--amber-soft);
    color: var(--amber);
  }

  .pk-badge--success,
  .pk-badge--info {
    background: var(--mint-soft);
    color: var(--mint);
  }

  .pk-badge--danger {
    background: var(--fault-soft);
    color: var(--fault);
  }
</style>
