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
      <div class="wb-shell__lead">
        <Button variant="secondary" size="sm" onclick={() => navigate('/tools')}>
          <Icon name="chevron-left" size="xs" />
          <span>{t('backToIndex', undefined, 'tools')}</span>
        </Button>

        <span class="wb-shell__sep" aria-hidden="true"></span>

        <span class="well wb-shell__icon" aria-hidden="true">
          <Icon name={meta.icon} size="md" />
        </span>

        <div class="wb-shell__title">
          <div class="wb-shell__title-row">
            <h2>{toolName(meta.id)}</h2>
            <span class="well wb-shell__badge mono">{meta.badge}</span>
          </div>
          <p>{toolDescription(meta.id)}</p>
        </div>
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
    padding: 1.375rem 1.5rem 1.625rem;
    display: flex;
    flex-direction: column;
    gap: 1.375rem;
  }

  /* Left-aligned workbench header aligned cleanly with form fields below */
  .wb-shell__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 1.0625rem;
    border-bottom: 1px solid var(--hairline);
    flex-wrap: wrap;
  }

  .wb-shell__lead {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .wb-shell__sep {
    width: 1px;
    height: 1.5rem;
    background: var(--hairline);
    flex-shrink: 0;
  }

  .wb-shell__icon {
    width: 2.375rem;
    height: 2.375rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5625rem;
    color: var(--mint);
    flex-shrink: 0;
  }

  .wb-shell__title {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .wb-shell__title-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .wb-shell__badge {
    padding: 0.125rem 0.4375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .wb-shell__title h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--ink);
  }

  .wb-shell__title p {
    font-size: 0.78125rem;
    color: var(--ink-3);
  }

  .wb-shell__right {
    flex-shrink: 0;
  }

  .wb-shell__loading {
    padding: 2rem 0;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  @media (max-width: 720px) {
    .wb-shell__sep {
      display: none;
    }
    .wb-shell__lead {
      flex-wrap: wrap;
    }
  }
</style>
