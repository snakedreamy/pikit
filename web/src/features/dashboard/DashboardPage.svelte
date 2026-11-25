<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiHttpError } from '../../lib/api';
  import { registerLocaleGlob, t, type MessageTree } from '../../lib/i18n/index.svelte';
  import { EmptyState } from '../../ui';
  import {
    ensureDashboardBookmarksLoaded,
    setPreviewBookmarkGroups,
  } from './api';
  import BookmarkCard from './BookmarkCard.svelte';
  import type { DashboardGroup } from './types';

  registerLocaleGlob(
    'dashboard',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  interface Props {
    previewGroups?: DashboardGroup[];
    onunauthorized?: () => void;
  }

  let { previewGroups, onunauthorized }: Props = $props();

  let loadedGroups = $state<DashboardGroup[]>([]);
  let loadError = $state('');
  let loading = $state(true);

  const groups = $derived(previewGroups ?? loadedGroups);

  onMount(() => {
    if (previewGroups) {
      setPreviewBookmarkGroups(previewGroups);
      loading = false;
      return () => {
        setPreviewBookmarkGroups(null);
      };
    }

    const ctrl = new AbortController();

    ensureDashboardBookmarksLoaded(ctrl.signal)
      .then((groupsData) => {
        loadedGroups = groupsData;
        loadError = '';
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          onunauthorized?.();
          return;
        }
        loadError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        loading = false;
      });

    return () => {
      ctrl.abort();
    };
  });
</script>

<div class="dash">
  {#if loadError}
    <EmptyState
      title={t('loadFailedTitle', undefined, 'dashboard')}
      reason={loadError}
    />
  {:else if !loading && groups.length === 0}
    <EmptyState
      title={t('emptyTitle', undefined, 'dashboard')}
      reason={t('emptyReason', undefined, 'dashboard')}
    />
  {:else if groups.length > 0}
    <div class="dash__groups">
      {#each groups as group, gIdx (`${gIdx}:${group.name}`)}
        <section class="dash-group">
          <header class="dash-group__head">
            <span class="dash-group__tick" aria-hidden="true"></span>
            <h2>{group.name}</h2>
            <span class="dash-group__line" aria-hidden="true"></span>
            <span class="dash-group__count mono">
              {t('groupCount', { count: group.items.length }, 'dashboard')}
            </span>
          </header>

          <div class="dash-group__grid">
            {#each group.items as item, iIdx (`${iIdx}:${item.name}:${item.url}`)}
              <BookmarkCard {item} />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dash {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .dash__groups {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .dash-group {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .dash-group__head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.125rem;
  }

  .dash-group__tick {
    width: 3px;
    height: 0.875rem;
    border-radius: 1.5px;
    background: var(--amber);
    flex-shrink: 0;
  }

  .dash-group__head h2 {
    font-size: 0.875rem;
    font-weight: 650;
    letter-spacing: 0.06em;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .dash-group__line {
    flex: 1;
    height: 1px;
    background: var(--hairline);
  }

  .dash-group__count {
    font-size: 0.6875rem;
    color: var(--ink-3);
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--glass);
    white-space: nowrap;
  }

  .dash-group__grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--gap);
  }

  @media (max-width: 1200px) {
    .dash-group__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 860px) {
    .dash-group__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .dash-group__grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
