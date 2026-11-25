<script lang="ts">
  import { Icon } from '../../ui';
  import BookmarkIcon from './BookmarkIcon.svelte';
  import type { DashboardItem } from './types';

  interface Props {
    item: DashboardItem;
  }

  let { item }: Props = $props();
</script>

<a
  href={item.url}
  target="_blank"
  rel="noreferrer noopener"
  class="plate bm-card"
>
  <BookmarkIcon name={item.name} iconUrl={item.iconUrl} iconText={item.iconText} />

  <div class="bm-card__body">
    <div class="bm-card__head">
      <b class="bm-card__name">{item.name}</b>
      <span class="bm-card__jump" aria-hidden="true">
        <Icon name="arrow-up-right" size="xs" />
      </span>
    </div>
    <code class="bm-card__host mono">{item.host}</code>
    {#if item.description}
      <p class="bm-card__desc">{item.description}</p>
    {/if}
  </div>
</a>

<style>
  .bm-card {
    display: flex;
    align-items: flex-start;
    gap: 0.9375rem;
    min-height: 5.75rem;
    padding: 0.9375rem 1.0625rem;
    transition:
      transform 0.14s var(--ease-out),
      background-color 0.14s,
      box-shadow 0.14s;
  }

  .bm-card:hover {
    transform: translateY(-1.5px);
    background: var(--plate-raised);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 2px 0 var(--plate-lo),
      0 10px 22px -6px rgb(0 0 0 / 0.48);
  }

  .bm-card:active {
    transform: translateY(0.5px);
  }

  .bm-card__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
  }

  .bm-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .bm-card__name {
    font-size: 0.9375rem;
    font-weight: 650;
    letter-spacing: 0.01em;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bm-card__jump {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--ink-3);
    transition:
      color 0.14s var(--ease-out),
      transform 0.14s var(--ease-out);
  }

  .bm-card:hover .bm-card__jump {
    color: var(--amber);
    transform: translate(1.5px, -1.5px);
  }

  .bm-card__host {
    font-size: 0.75rem;
    color: var(--mint-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.14s;
  }

  .bm-card:hover .bm-card__host {
    color: var(--mint);
  }

  .bm-card__desc {
    margin-top: 0.0625rem;
    font-size: 0.75rem;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
