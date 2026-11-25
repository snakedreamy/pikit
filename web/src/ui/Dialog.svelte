<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n/index.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open?: boolean;
    title: string;
    description?: string;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    description,
    onclose,
    children,
    footer,
  }: Props = $props();

  let panelEl: HTMLDivElement | undefined = $state();
  const titleId = `pk-dlg-title-${Math.random().toString(36).slice(2, 8)}`;
  const descId = `pk-dlg-desc-${Math.random().toString(36).slice(2, 8)}`;

  function close() {
    open = false;
    onclose?.();
  }

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const prevFocus = document.activeElement as HTMLElement | null;

    queueMicrotask(() => {
      const focusables = panelEl?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      focusables?.[0]?.focus();
    });

    return () => {
      prevFocus?.focus?.();
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab' && panelEl) {
      const nodes = Array.from(
        panelEl.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

{#if open}
  <div class="pk-dialog-backdrop" onclick={close} role="presentation">
    <div
      bind:this={panelEl}
      class="plate pk-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <header class="pk-dialog__header">
        <div>
          <h2 id={titleId} class="pk-dialog__title">{title}</h2>
          {#if description}
            <p id={descId} class="pk-dialog__desc">{description}</p>
          {/if}
        </div>
        <IconButton icon="x" size="sm" variant="ghost" label={t('common.close')} onclick={close} />
      </header>

      <div class="pk-dialog__body">
        {@render children()}
      </div>

      {#if footer}
        <footer class="pk-dialog__footer">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pk-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--backdrop);
  }

  .pk-dialog {
    width: 100%;
    max-width: 28rem;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 1.25rem 3rem rgb(0 0 0 / 0.5);
    overflow: hidden;
  }

  .pk-dialog__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: var(--pad);
    border-bottom: 1px solid var(--groove);
  }

  .pk-dialog__title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink);
  }

  .pk-dialog__desc {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .pk-dialog__body {
    padding: var(--pad);
    font-size: 0.875rem;
    color: var(--ink-2);
  }

  .pk-dialog__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem var(--pad);
    border-top: 1px solid var(--groove);
  }
</style>
