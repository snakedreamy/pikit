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
            <h2>{group.name}</h2>
            <span class="dash-group__count">
              {t('groupCount', { count: group.items.length }, 'dashboard')}
            </span>
            <span class="dash-group__line" aria-hidden="true"></span>
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
    gap: 2.25rem;
  }

  .dash-group {
    display: flex;
    flex-direction: column;
    gap: 0.9375rem;
  }

  .dash-group__head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .dash-group__head h2 {
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.005em;
    color: var(--ink);
    white-space: nowrap;
  }

  .dash-group__count {
    font-size: 0.8125rem;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .dash-group__line {
    flex: 1;
    height: 1px;
    background: var(--hairline);
    align-self: center;
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
