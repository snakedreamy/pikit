<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    content: string;
    placement?: 'top' | 'bottom';
    children: Snippet;
  }

  let { content, placement = 'top', children }: Props = $props();
  let visible = $state(false);
  const tipId = `pk-tip-${Math.random().toString(36).slice(2, 9)}`;

  function show() {
    visible = true;
  }
  function hide() {
    visible = false;
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') hide();
  }
</script>

<span
  class="pk-tooltip-anchor"
  aria-describedby={visible ? tipId : undefined}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
  onkeydown={handleKeydown}
  role="presentation"
>
  {@render children()}
  {#if visible && content}
    <span id={tipId} role="tooltip" class="plate pk-tooltip pk-tooltip--{placement}">
      {content}
    </span>
  {/if}
</span>

<style>
  .pk-tooltip-anchor {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .pk-tooltip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-tooltip);
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--chassis-deep);
    color: var(--ink);
    font-size: 0.75rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 0.5rem 1.25rem rgb(0 0 0 / 0.45);
  }

  .pk-tooltip--top {
    bottom: calc(100% + 6px);
  }

  .pk-tooltip--bottom {
    top: calc(100% + 6px);
  }
</style>
