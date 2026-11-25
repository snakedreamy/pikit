<script lang="ts">
  import { getLocale, t } from '../lib/i18n/index.svelte';
  import { navigate } from '../lib/router.svelte';
  import {
    filterSearchEntries,
    getAllSearchGroups,
    type SearchEntry,
  } from '../lib/search';
  import { Icon } from '../ui';

  interface Props {
    open?: boolean;
    entries: SearchEntry[];
  }

  let { open = $bindable(false), entries }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const filtered = $derived(filterSearchEntries(entries, query));

  // Aggregate matching entries in the order declared by registered search sources
  const grouped = $derived.by(() => {
    const groups = getAllSearchGroups();
    const sections: Array<{ key: string; title: string; items: SearchEntry[] }> = [];
    const knownIds = new Set<string>();

    for (const grp of groups) {
      knownIds.add(grp.id);
      const items = filtered.filter((e) => e.group === grp.id);
      if (items.length > 0) {
        sections.push({ key: grp.id, title: grp.getTitle(), items });
      }
    }

    const uncategorized = filtered.filter((e) => !knownIds.has(e.group));
    if (uncategorized.length > 0) {
      sections.push({ key: 'other', title: uncategorized[0].group, items: uncategorized });
    }

    return sections;
  });

  const flatOrdered = $derived(grouped.flatMap((g) => g.items));
  const flatIndexById = $derived(
    new Map(flatOrdered.map((entry, idx) => [entry.id, idx]))
  );

  $effect(() => {
    void query;
    activeIndex = 0;
  });

  $effect(() => {
    if (flatOrdered.length === 0) {
      activeIndex = 0;
    } else if (activeIndex >= flatOrdered.length) {
      activeIndex = flatOrdered.length - 1;
    }
  });

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const prevFocus = document.activeElement as HTMLElement | null;
    query = '';
    activeIndex = 0;
    queueMicrotask(() => inputEl?.focus());
    return () => prevFocus?.focus?.();
  });

  function close() {
    open = false;
  }

  function activateEntry(entry: SearchEntry) {
    close();
    if (entry.external) {
      if (/^https?:\/\//i.test(entry.href)) {
        window.open(entry.href, '_blank', 'noopener,noreferrer');
      }
    } else {
      navigate(entry.href);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (flatOrdered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % flatOrdered.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + flatOrdered.length) % flatOrdered.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = flatOrdered[activeIndex];
      if (chosen) activateEntry(chosen);
    }
  }
</script>

{#if open}
  <div class="pk-palette-backdrop" onclick={close} role="presentation">
    <div
      class="sheet-plate pk-palette"
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.title')}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <div class="pk-palette__top">
        <div class="glass pk-palette__search">
          <Icon name="search" size="sm" />
          <input
            bind:this={inputEl}
            bind:value={query}
            type="text"
            class="pk-palette__input"
            placeholder={t('palette.placeholder')}
            autocomplete="off"
            spellcheck="false"
          />
          <span class="pk-palette__count mono">
            {t('palette.result', { count: flatOrdered.length })}
          </span>
        </div>
      </div>

      <div class="pk-palette__results" role="listbox">
        {#if flatOrdered.length === 0}
          <div class="pk-palette__empty">
            <p class="pk-palette__empty-title">{t('palette.emptyTitle')}</p>
            <p class="pk-palette__empty-reason">
              {t('palette.emptyReason', { query })}
            </p>
          </div>
        {:else}
          {#each grouped as section (section.key)}
            <div class="pk-palette__group">
              <div class="legend pk-palette__group-title">{section.title}</div>
              {#each section.items as item (item.id)}
                {@const flatIdx = flatIndexById.get(item.id) ?? 0}
                {@const selected = flatIdx === activeIndex}
                {@const locale = getLocale()}
                <button
                  type="button"
                  role="option"
                  class="pk-palette__item"
                  data-selected={selected ? 'true' : undefined}
                  aria-selected={selected ? 'true' : 'false'}
                  onmouseenter={() => (activeIndex = flatIdx)}
                  onclick={() => activateEntry(item)}
                >
                  <span class="lamp" data-color={selected ? 'amber' : 'dim'} aria-hidden="true"></span>
                  <span class="pk-palette__item-main">
                    <span class="pk-palette__item-label">{item.labels[locale]}</span>
                    {#if item.subtitles?.[locale]}
                      <span class="pk-palette__item-sub">{item.subtitles[locale]}</span>
                    {/if}
                  </span>
                  <span class="pk-palette__item-href mono">{item.href}</span>
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>

      <footer class="pk-palette__footer mono">
        <span>{t('palette.hintNavigate')}</span>
        <span>{t('palette.hintOpen')}</span>
        <span>{t('palette.hintClose')}</span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .pk-palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-palette);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 1rem 1rem;
    background: var(--backdrop);
  }

  .pk-palette {
    width: 100%;
    max-width: 35rem;
    overflow: hidden;
  }

  .pk-palette__top {
    padding: 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }

  .pk-palette__search {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    height: 2.5rem;
    padding: 0 0.75rem;
    color: var(--ink-3);
  }

  .pk-palette__input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ink);
    font-size: 0.875rem;
  }
  .pk-palette__input:focus,
  .pk-palette__input:focus-visible {
    outline: none;
  }
  .pk-palette__input::placeholder {
    color: var(--ink-3);
  }

  .pk-palette__count {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .pk-palette__results {
    max-height: 20rem;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .pk-palette__group + .pk-palette__group {
    margin-top: 0.5rem;
  }

  .pk-palette__group-title {
    padding: 0.25rem 1rem;
    font-size: 0.6875rem;
  }

  .pk-palette__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5rem 1rem;
    border: 0;
    border-left: 3px solid transparent;
    background: transparent;
    color: var(--ink);
    text-align: left;
  }

  .pk-palette__item[data-selected='true'] {
    border-left-color: var(--amber);
    background: var(--amber-soft);
  }

  .pk-palette__item-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .pk-palette__item-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .pk-palette__item-sub {
    font-size: 0.75rem;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pk-palette__item-href {
    font-size: 0.75rem;
    color: var(--mint-dim);
  }

  .pk-palette__empty {
    padding: 1.5rem 1rem;
    text-align: center;
  }
  .pk-palette__empty-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }
  .pk-palette__empty-reason {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .pk-palette__footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--hairline);
    font-size: 0.6875rem;
    color: var(--ink-3);
  }
</style>
