<script lang="ts">
  import type { Component } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { navigate } from '../../lib/router.svelte';
  import { Button, EmptyState, Icon } from '../../ui';
  import { isFavoriteTool, toggleFavoriteTool } from './favorites.svelte';
  import { getToolMetaById, toolDescription, toolName } from './registry';

  interface Props {
    toolId: string;
  }

  let { toolId }: Props = $props();

  let LoadedComponent = $state<Component | null>(null);
  let loading = $state(false);
  let loadError = $state('');
  let reloadNonce = $state(0);

  const meta = $derived(getToolMetaById(toolId));
  const starred = $derived(meta ? isFavoriteTool(meta.id) : false);

  $effect(() => {
    void reloadNonce;
    const current = meta;
    LoadedComponent = null;
    loadError = '';
    if (!current) {
      loading = false;
      return;
    }

    let cancelled = false;
    loading = true;
    current
      .load()
      .then((mod) => {
        if (!cancelled) {
          LoadedComponent = mod.default;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          loadError = err instanceof Error ? err.message : String(err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          loading = false;
        }
      });

    return () => {
      cancelled = true;
    };
  });
</script>

{#if !meta}
  <EmptyState
    title={t('unknownToolTitle', undefined, 'tools')}
    reason={t('unknownToolReason', { id: toolId }, 'tools')}
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={() => navigate('/tools')}>
        {t('backToIndex', undefined, 'tools')}
      </Button>
    {/snippet}
  </EmptyState>
{:else}
  <section class="plate wb-shell">
    <header class="wb-shell__head">
      <div class="wb-shell__left">
        <Button variant="secondary" size="sm" onclick={() => navigate('/tools')}>
          <Icon name="chevron-left" size="xs" />
          <span>{t('backToIndex', undefined, 'tools')}</span>
        </Button>
      </div>

      <div class="wb-shell__center">
        <div class="wb-shell__title-row">
          <span class="glass wb-shell__icon" aria-hidden="true">
            <Icon name={meta.icon} size="md" />
          </span>
          <h2>{toolName(meta.id)}</h2>
          <span class="glass wb-shell__badge mono">{meta.badge}</span>
        </div>
        <p>{toolDescription(meta.id)}</p>
      </div>

      <div class="wb-shell__right">
        <Button
          variant={starred ? 'primary' : 'secondary'}
          size="sm"
          onclick={() => toggleFavoriteTool(meta.id)}
        >
          <Icon name="star" size="xs" />
          <span>
            {starred
              ? t('favoriteRemove', undefined, 'tools')
              : t('favoriteAdd', undefined, 'tools')}
          </span>
        </Button>
      </div>
    </header>

    <div class="wb-shell__body">
      {#if loadError}
        <EmptyState
          title={t('loadFailedTitle', undefined, 'tools')}
          reason={loadError}
        >
          {#snippet actions()}
            <Button variant="primary" size="sm" onclick={() => (reloadNonce += 1)}>
              {t('retryLoad', undefined, 'tools')}
            </Button>
          {/snippet}
        </EmptyState>
      {:else if loading || !LoadedComponent}
        <p class="wb-shell__loading mono">{t('loadingTool', undefined, 'tools')}</p>
      {:else}
        <LoadedComponent />
      {/if}
    </div>
  </section>
{/if}

<style>
  .wb-shell {
    padding: 1.25rem 1.375rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* Symmetric 3-column header: back button (left), tool title (center), star toggle (right) */
  .wb-shell__head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--hairline);
  }

  .wb-shell__left {
    justify-self: start;
  }

  .wb-shell__center {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .wb-shell__title-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5625rem;
  }

  .wb-shell__icon {
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-key);
    color: var(--mint);
  }

  .wb-shell__badge {
    padding: 0.125rem 0.4375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--mint);
  }

  .wb-shell__center h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--ink);
  }

  .wb-shell__center p {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .wb-shell__right {
    justify-self: end;
  }

  .wb-shell__loading {
    padding: 2rem 0;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  @media (max-width: 720px) {
    .wb-shell__head {
      grid-template-columns: 1fr 1fr;
    }
    .wb-shell__center {
      grid-column: 1 / -1;
      order: -1;
    }
  }
</style>
