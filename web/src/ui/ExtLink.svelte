<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    href: string;
    showArrow?: boolean;
    className?: string;
    children: Snippet;
  }

  let { href, showArrow = true, className = '', children }: Props = $props();
  const safeHref = $derived(/^https?:\/\//i.test(href) ? href : '#');
</script>

<a
  class="pk-ext-link mono {className}"
  href={safeHref}
  target="_blank"
  rel="noreferrer noopener"
>
  <span>{@render children()}</span>
  {#if showArrow}
    <Icon name="external-link" size="xs" />
  {/if}
</a>

<style>
  .pk-ext-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    color: var(--mint);
    text-decoration: underline;
    text-decoration-color: rgb(118 240 213 / 0.35);
    text-underline-offset: 0.22em;
  }
  .pk-ext-link:hover {
    color: var(--ink);
  }
</style>
