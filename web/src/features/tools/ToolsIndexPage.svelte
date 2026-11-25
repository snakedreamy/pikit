<script lang="ts">
  import { getLocale, t } from '../../lib/i18n/index.svelte';
  import { navigate } from '../../lib/router.svelte';
  import { Button, EmptyState, Icon, Select } from '../../ui';
  import { getFavoriteToolIds, isFavoriteTool, toggleFavoriteTool } from './favorites.svelte';
  import {
    getAllToolMetas,
    getCategoryLabel,
    TOOL_CATEGORY_IDS,
    toolDescription,
    toolName,
  } from './registry';
  import type { ToolCategory, ToolSummary } from './types';

  let selectedCategory = $state<string>('all');
  let starredOnly = $state(false);

  const locale = $derived(getLocale());

  const allSummaries = $derived.by<ToolSummary[]>(() =>
    getAllToolMetas().map((m) => ({
      id: m.id,
      category: m.category,
      order: m.order,
      icon: m.icon,
      badge: m.badge,
      name: toolName(m.id),
      description: toolDescription(m.id),
    }))
  );

  const favIds = $derived(getFavoriteToolIds());

  const starredItems = $derived(
    allSummaries.filter((item) => favIds.includes(item.id))
  );

  // List only categories that currently contain registered tools (scales automatically as new categories are populated)
  const populatedCategories = $derived.by(() => {
    const out: Array<{ id: ToolCategory; label: string; items: ToolSummary[] }> = [];
    for (const catId of TOOL_CATEGORY_IDS) {
      const items = allSummaries.filter((tItem) => tItem.category === catId);
      if (items.length > 0) {
        out.push({
          id: catId,
          label: getCategoryLabel(catId, locale),
          items,
        });
      }
    }
    return out;
  });

  const categorySelectOptions = $derived([
    {
      value: 'all',
      label: t('allCategories', { count: allSummaries.length }, 'tools'),
    },
    ...populatedCategories.map((c) => ({
      value: c.id,
      label: t('categoryOption', { label: c.label, count: c.items.length }, 'tools'),
    })),
  ]);

  const displayedSections = $derived.by(() => {
    if (starredOnly) {
      const filteredFavs =
        selectedCategory === 'all'
          ? starredItems
          : starredItems.filter((item) => item.category === selectedCategory);
      if (filteredFavs.length === 0) return [];
      return [
        {
          key: 'starred',
          title: `★ ${t('sectionStarred', undefined, 'tools')}`,
          items: filteredFavs,
        },
      ];
    }

    if (selectedCategory !== 'all') {
      const found = populatedCategories.find((c) => c.id === selectedCategory);
      if (!found) return [];
      return [{ key: found.id, title: found.label, items: found.items }];
    }

    const sections: Array<{ key: string; title: string; items: ToolSummary[] }> = [];
    if (starredItems.length > 0) {
      sections.push({
        key: 'starred',
        title: `★ ${t('sectionStarred', undefined, 'tools')}`,
        items: starredItems,
      });
    }
    for (const cat of populatedCategories) {
      sections.push({
        key: cat.id,
        title: cat.label,
        items: cat.items,
      });
    }
    return sections;
  });
</script>

<div class="tools-index">
  <!-- Frameless header bar keeping raised card elevation strictly for clickable tool cards -->
  <header class="tools-bar">
    <div class="tools-bar__title">
      <h2>{t('title', undefined, 'tools')}</h2>
      <p>{t('subtitle', { count: allSummaries.length }, 'tools')}</p>
    </div>

    <div class="tools-bar__controls">
      <Button
        variant={starredOnly ? 'primary' : 'secondary'}
        size="sm"
        onclick={() => (starredOnly = !starredOnly)}
      >
        <Icon name="star" size="xs" />
        <span>{t('onlyStarred', { count: starredItems.length }, 'tools')}</span>
      </Button>

      <div class="tools-bar__select">
        <Select
          ariaLabel={t('filterCategoryAria', undefined, 'tools')}
          bind:value={selectedCategory}
          options={categorySelectOptions}
        />
      </div>
    </div>
  </header>

  {#if displayedSections.length === 0}
    <EmptyState
      title={t('emptyFavTitle', undefined, 'tools')}
      reason={t('emptyFavReason', undefined, 'tools')}
    />
  {:else}
    <div class="tools-sections">
      {#each displayedSections as section (section.key)}
        <section class="tools-group">
          <header class="tools-group__head">
            <span class="tools-group__tick" aria-hidden="true"></span>
            <h3>{section.title}</h3>
            <span class="tools-group__line" aria-hidden="true"></span>
            <span class="tools-group__count mono">
              {t('groupCount', { count: section.items.length }, 'tools')}
            </span>
          </header>

          <div class="tools-grid">
            {#each section.items as item (`${section.key}:${item.id}`)}
              {@const starred = isFavoriteTool(item.id)}
              <article class="plate tool-card">
                <div class="tool-card__top">
                  <div class="tool-card__identity">
                    <span class="glass tool-card__icon" aria-hidden="true">
                      <Icon name={item.icon} size="md" />
                    </span>
                    <span class="tool-card__badge mono">{item.badge}</span>
                  </div>
                  <button
                    type="button"
                    class="tool-card__star"
                    data-starred={starred ? 'true' : undefined}
                    aria-label={starred
                      ? t('favoriteRemove', undefined, 'tools')
                      : t('favoriteAdd', undefined, 'tools')}
                    aria-pressed={starred ? 'true' : 'false'}
                    onclick={() => toggleFavoriteTool(item.id)}
                  >
                    <Icon name="star" size="xs" />
                  </button>
                </div>

                <a
                  href={`/tools/${item.id}`}
                  class="tool-card__link"
                  onclick={(e) => {
                    e.preventDefault();
                    navigate(`/tools/${item.id}`);
                  }}
                >
                  <h4 class="tool-card__name">{item.name}</h4>
                  <p class="tool-card__desc">{item.description}</p>
                </a>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tools-index {
    display: flex;
    flex-direction: column;
    gap: 1.625rem;
  }

  .tools-bar {
    padding: 0 0.125rem 0.875rem;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .tools-bar__title h2 {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--ink);
  }

  .tools-bar__title p {
    margin-top: 0.25rem;
    font-size: 0.78125rem;
    color: var(--ink-3);
  }

  .tools-bar__controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tools-bar__select {
    width: 11.75rem;
  }

  .tools-sections {
    display: flex;
    flex-direction: column;
    gap: 1.875rem;
  }

  .tools-group {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .tools-group__head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.125rem;
  }

  .tools-group__tick {
    width: 3px;
    height: 0.875rem;
    border-radius: 1.5px;
    background: var(--amber);
    flex-shrink: 0;
  }

  .tools-group__head h3 {
    font-size: 0.875rem;
    font-weight: 650;
    letter-spacing: 0.06em;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .tools-group__line {
    flex: 1;
    height: 1px;
    background: var(--hairline);
  }

  .tools-group__count {
    font-size: 0.6875rem;
    color: var(--ink-3);
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--glass);
    white-space: nowrap;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--gap);
  }

  .tool-card {
    padding: 0.9375rem 1.0625rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    min-height: 6.375rem;
    transition:
      transform 0.14s var(--ease-out),
      background-color 0.14s;
  }

  .tool-card:hover {
    transform: translateY(-1.5px);
    background: var(--plate-raised);
  }

  .tool-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .tool-card__identity {
    display: inline-flex;
    align-items: center;
    gap: 0.5625rem;
    min-width: 0;
  }

  .tool-card__icon {
    width: 2.125rem;
    height: 2.125rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-key);
    color: var(--mint);
    flex-shrink: 0;
    transition: color 0.14s;
  }

  .tool-card:hover .tool-card__icon {
    color: var(--amber);
  }

  .tool-card__badge {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--ink-3);
    letter-spacing: 0.04em;
  }

  .tool-card__star {
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 0.3125rem;
    background: transparent;
    color: var(--ink-3);
    transition: color 0.14s, background-color 0.14s;
  }

  .tool-card__star:hover {
    background: var(--groove);
    color: var(--ink);
  }

  .tool-card__star[data-starred='true'] {
    color: var(--amber);
  }

  .tool-card__link {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tool-card__name {
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--ink);
  }

  .tool-card__desc {
    font-size: 0.75rem;
    color: var(--ink-3);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (max-width: 1200px) {
    .tools-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 860px) {
    .tools-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .tools-bar__controls {
      width: 100%;
      justify-content: space-between;
    }
    .tools-bar__select {
      flex: 1;
    }
    .tools-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
