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
            <h3>{section.title}</h3>
            <span class="tools-group__count">
              {t('groupCount', { count: section.items.length }, 'tools')}
            </span>
            <span class="tools-group__line" aria-hidden="true"></span>
          </header>

          <div class="tools-grid">
            {#each section.items as item (`${section.key}:${item.id}`)}
              {@const starred = isFavoriteTool(item.id)}
              <article class="plate tool-card">
                <span class="well tool-card__icon" aria-hidden="true">
                  <Icon name={item.icon} size="md" />
                </span>

                <a
                  href={`/tools/${item.id}`}
                  class="tool-card__link"
                  onclick={(e) => {
                    e.preventDefault();
                    navigate(`/tools/${item.id}`);
                  }}
                >
                  <h4 class="tool-card__name">{item.name}</h4>
                </a>

                <span class="tool-card__badge mono">{item.badge}</span>
                <p class="tool-card__desc">{item.description}</p>

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
    gap: 1.75rem;
  }

  .tools-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .tools-bar__title h2 {
    font-size: 1.4375rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--ink);
  }

  .tools-bar__title p {
    margin-top: 0.1875rem;
    font-size: 0.84375rem;
    color: var(--ink-3);
  }

  .tools-bar__controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tools-bar__select {
    width: 12rem;
  }

  .tools-sections {
    display: flex;
    flex-direction: column;
    gap: 2.125rem;
  }

  .tools-group {
    display: flex;
    flex-direction: column;
    gap: 0.9375rem;
  }

  .tools-group__head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .tools-group__head h3 {
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.005em;
    color: var(--ink);
    white-space: nowrap;
  }

  .tools-group__count {
    font-size: 0.8125rem;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .tools-group__line {
    flex: 1;
    height: 1px;
    background: var(--hairline);
    align-self: center;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--gap);
  }

  /* Matches BookmarkCard 2-column icon-spanning grid with stretched link for full-card clickability */
  .tool-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.125rem 0.9375rem;
    align-content: start;
    padding: 1.0625rem 1.125rem 1.125rem;
    transition:
      transform 0.14s var(--ease-out),
      background-color 0.14s,
      box-shadow 0.14s;
  }

  .tool-card:hover {
    transform: translateY(-2px);
    background: var(--plate-raised);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo),
      var(--plate-shadow-hover);
  }

  .tool-card:active {
    transform: translateY(0.5px);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo);
  }

  .tool-card__icon {
    grid-row: 1 / 3;
    width: 2.75rem;
    height: 2.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.625rem;
    color: var(--mint);
    flex-shrink: 0;
    transition: color 0.14s;
  }

  .tool-card:hover .tool-card__icon {
    color: var(--amber);
  }

  .tool-card__link {
    align-self: end;
    min-width: 0;
  }

  .tool-card__link::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    z-index: 1;
  }

  .tool-card__name {
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.3;
    color: var(--ink);
    padding-right: 1.625rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card__badge {
    align-self: start;
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1.45;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card__desc {
    grid-column: 1 / -1;
    margin-top: 0.625rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
    line-height: 1.48;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.4em;
  }

  .tool-card__star {
    position: absolute;
    top: 0.875rem;
    right: 0.875rem;
    z-index: 2;
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--ink-3);
    opacity: 0.65;
    transition:
      color 0.14s,
      opacity 0.14s,
      background-color 0.14s;
  }

  .tool-card:hover .tool-card__star {
    opacity: 1;
  }

  .tool-card__star:hover {
    background: var(--groove);
    color: var(--amber);
  }

  .tool-card__star[data-starred='true'] {
    opacity: 1;
    color: var(--amber);
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
