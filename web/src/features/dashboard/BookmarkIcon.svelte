<script lang="ts">
  import { deriveBookmarkMonogram } from './monogram';

  interface Props {
    name: string;
    iconUrl?: string;
    iconText?: string;
  }

  let { name, iconUrl, iconText }: Props = $props();

  let failedUrl = $state<string | null>(null);

  const showImage = $derived(Boolean(iconUrl) && failedUrl !== iconUrl);
  const monogram = $derived(deriveBookmarkMonogram(name, iconText));
</script>

<span class="well bm-icon" aria-hidden="true">
  {#if showImage && iconUrl}
    <img
      src={iconUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onerror={() => {
        failedUrl = iconUrl ?? null;
      }}
    />
  {:else}
    <span class="bm-icon__text mono" data-len={monogram.length}>{monogram}</span>
  {/if}
</span>

<style>
  .bm-icon {
    width: 2.875rem;
    height: 2.875rem;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.625rem;
    overflow: hidden;
    transition: box-shadow 0.16s var(--ease-out);
  }

  .bm-icon img {
    width: 1.875rem;
    height: 1.875rem;
    border-radius: 0.375rem;
    object-fit: contain;
    display: block;
  }

  .bm-icon__text {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--amber);
    line-height: 1;
    user-select: none;
  }

  .bm-icon__text[data-len='3'] {
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
  }
</style>
