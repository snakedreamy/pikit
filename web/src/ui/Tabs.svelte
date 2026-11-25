<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons/names';

  export interface TabItem {
    id: string;
    label: string;
    icon?: IconName;
    badge?: string;
  }

  interface Props {
    value?: string;
    tabs: TabItem[];
    ariaLabel?: string;
    onchange?: (id: string) => void;
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    tabs,
    ariaLabel,
    onchange,
    children,
  }: Props = $props();

  let listEl: HTMLDivElement | undefined = $state();

  function selectTab(id: string) {
    if (id === value) return;
    value = id;
    onchange?.(id);
  }

  function handleKeydown(e: KeyboardEvent, idx: number) {
    if (tabs.length === 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;

    if (nextIdx >= 0) {
      e.preventDefault();
      selectTab(tabs[nextIdx].id);
      const buttons = listEl?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
      buttons?.[nextIdx]?.focus();
    }
  }
</script>

<div class="pk-tabs">
  <div bind:this={listEl} class="pk-tabs__list" role="tablist" aria-label={ariaLabel}>
    {#each tabs as tab, idx (tab.id)}
      {@const active = tab.id === value}
      <button
        type="button"
        role="tab"
        class="pk-tabs__tab"
        aria-selected={active ? 'true' : 'false'}
        tabindex={active ? 0 : -1}
        onclick={() => selectTab(tab.id)}
        onkeydown={(e) => handleKeydown(e, idx)}
      >
        <span>{tab.label}</span>
        {#if tab.badge}
          <span class="pk-tabs__badge mono">{tab.badge}</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if children}
    <div class="pk-tabs__panel" role="tabpanel">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .pk-tabs {
    display: flex;
    flex-direction: column;
  }

  .pk-tabs__list {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    border-bottom: 1px solid var(--groove);
    overflow-x: auto;
  }

  .pk-tabs__tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    height: 2.25rem;
    padding: 0 0.125rem;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 0.8125rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .pk-tabs__tab:hover {
    color: var(--ink);
  }

  .pk-tabs__tab[aria-selected='true'] {
    color: var(--ink);
  }

  .pk-tabs__tab[aria-selected='true']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--amber);
  }

  .pk-tabs__badge {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .pk-tabs__panel {
    padding-top: 0.875rem;
  }
</style>
