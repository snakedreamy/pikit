<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons/names';

  interface Props {
    icon?: IconName;
    title: string;
    reason: string;
    actions?: Snippet;
  }

  let { title, reason, actions }: Props = $props();
</script>

<div class="pk-empty">
  <div class="pk-empty__head">
    <span class="lamp" data-color="dim" aria-hidden="true"></span>
    <h4 class="pk-empty__title">{title}</h4>
  </div>
  <p class="pk-empty__reason">{reason}</p>
  {#if actions}
    <div class="pk-empty__actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .pk-empty {
    padding: 1rem 1.125rem;
    border-radius: var(--r-glass);
    background: var(--groove);
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .pk-empty__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .pk-empty__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }

  .pk-empty__reason {
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--ink-2);
  }

  .pk-empty__actions {
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
