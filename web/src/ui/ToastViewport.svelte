<script lang="ts">
  import { dismissToast, getToasts } from './toast.svelte';
</script>

{#if getToasts().length > 0}
  <div class="pk-notice-wrap" role="region" aria-live="polite" aria-label="Notifications">
    {#each getToasts() as item (item.id)}
      <button
        type="button"
        class="pk-notice"
        data-tone={item.tone}
        onclick={() => dismissToast(item.id)}
      >
        <span
          class="lamp"
          data-color={item.tone === 'danger' ? 'fault' : item.tone === 'warning' ? 'amber' : 'mint'}
          aria-hidden="true"
        ></span>
        <span>{item.message}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .pk-notice-wrap {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    z-index: var(--z-toast);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(38rem, calc(100vw - 2rem));
  }

  .pk-notice {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 1rem;
    border: 0;
    border-radius: var(--r-key);
    background: var(--notice-bg);
    color: var(--mint);
    font-size: 0.875rem;
    text-align: left;
    box-shadow:
      inset 0 0 0 1px var(--mint-soft),
      0 0.75rem 2rem rgb(0 0 0 / 0.45);
    animation: pk-notice-in 0.22s var(--ease-out);
  }

  .pk-notice[data-tone='danger'] {
    background: var(--notice-fault-bg);
    color: var(--fault);
    box-shadow:
      inset 0 0 0 1px var(--fault-soft),
      0 0.75rem 2rem rgb(0 0 0 / 0.45);
  }

  .pk-notice[data-tone='warning'] {
    color: var(--amber);
    box-shadow:
      inset 0 0 0 1px var(--amber-soft),
      0 0.75rem 2rem rgb(0 0 0 / 0.45);
  }

  @keyframes pk-notice-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
</style>
