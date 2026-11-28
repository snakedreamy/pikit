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
  <span class="bm-card__icon-slot">
    <BookmarkIcon name={item.name} iconUrl={item.iconUrl} iconText={item.iconText} />
  </span>

  <b class="bm-card__name">{item.name}</b>
  <code class="bm-card__host mono">{item.host}</code>

  {#if item.description}
    <p class="bm-card__desc">{item.description}</p>
  {/if}

  <span class="bm-card__jump" aria-hidden="true">
    <Icon name="arrow-up-right" size="xs" />
  </span>
</a>

<style>
  .bm-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.1875rem 0.9375rem;
    align-content: start;
    padding: 1.0625rem 1.125rem 1.125rem;
    transition:
      transform 0.14s var(--ease-out),
      background-color 0.14s,
      box-shadow 0.14s;
  }

  .bm-card:hover {
    transform: translateY(-2px);
    background: var(--plate-raised);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo),
      var(--plate-shadow-hover);
  }

  .bm-card:active {
    transform: translateY(0.5px);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo);
  }

  .bm-card__icon-slot {
    grid-row: 1 / 3;
    display: inline-flex;
  }

  .bm-card__name {
    align-self: end;
    font-size: 1.03125rem;
    font-weight: 650;
    line-height: 1.28;
    color: var(--ink);
    padding-right: 1.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bm-card__host {
    align-self: start;
    font-size: 0.75rem;
    line-height: 1.4;
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
    grid-column: 1 / -1;
    margin-top: 0.625rem;
    font-size: 0.8125rem;
    line-height: 1.48;
    color: var(--ink-3);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.4em;
  }

  .bm-card__jump {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: inline-flex;
    color: var(--ink-3);
    opacity: 0.6;
    transition:
      color 0.14s var(--ease-out),
      opacity 0.14s var(--ease-out),
      transform 0.14s var(--ease-out);
  }

  .bm-card:hover .bm-card__jump {
    color: var(--amber);
    opacity: 1;
    transform: translate(2px, -2px);
  }
</style>
