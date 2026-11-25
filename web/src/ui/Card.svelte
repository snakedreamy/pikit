<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    subtitle?: string;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    interactive?: boolean;
    headerActions?: Snippet;
    children: Snippet;
  }

  let {
    title,
    subtitle,
    padding = 'md',
    interactive = false,
    headerActions,
    children,
  }: Props = $props();
</script>

<section class="plate pk-card" class:pk-card--interactive={interactive}>
  {#if title || subtitle || headerActions}
    <header class="pk-card__head">
      <div class="legend">
        {#if title}
          <span>{title}</span>
        {/if}
        {#if subtitle}
          <span class="legend__note">{subtitle}</span>
        {/if}
      </div>
      {#if headerActions}
        <div class="pk-card__actions">
          {@render headerActions()}
        </div>
      {/if}
    </header>
  {/if}
  <div class="pk-card__body pk-card__body--{padding}">
    {@render children()}
  </div>
</section>

<style>
  .pk-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pk-card--interactive {
    transition: background-color var(--dur-fast) ease;
  }

  .pk-card--interactive:hover {
    background: var(--plate-raised);
  }

  .pk-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: var(--pad) var(--pad) 0;
    min-width: 0;
  }

  .pk-card__head .legend {
    min-width: 0;
    overflow: hidden;
  }

  .pk-card__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
  }

  .pk-card__body--none {
    padding: 0;
  }
  .pk-card__body--sm {
    padding: 0.75rem;
  }
  .pk-card__body--md {
    padding: var(--pad);
  }
  .pk-card__body--lg {
    padding: 1.25rem;
  }

  .pk-card__head + .pk-card__body--md {
    padding-top: 0.75rem;
  }
</style>
