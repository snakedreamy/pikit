<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import { pushToast } from './toast.svelte';

  interface Props {
    text: string;
    label?: string;
    size?: 'sm' | 'md';
  }

  let { text, label, size = 'sm' }: Props = $props();
  let copied = $state(false);
  let timer: number | undefined;

  function fallbackExecCopy(val: string): boolean {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, val.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }

  async function copyNow() {
    if (!text) return;
    let ok = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = fallbackExecCopy(text);
      }
    } else {
      ok = fallbackExecCopy(text);
    }

    if (ok) {
      copied = true;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied = false;
      }, 1500);
    } else {
      pushToast(t('common.copyFailed'), 'danger');
    }
  }
</script>

<button
  type="button"
  class="pk-copy pk-copy--{size}"
  data-copied={copied ? 'true' : undefined}
  aria-label={copied ? t('common.copied') : label ?? t('common.copy')}
  disabled={!text}
  onclick={copyNow}
>
  {#if copied}
    <span class="lamp" data-color="mint"></span>
  {/if}
  <span>{copied ? t('common.copied') : label ?? t('common.copy')}</span>
</button>

<style>
  .pk-copy {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border: 0;
    border-radius: var(--r-key);
    background: var(--plate-raised);
    color: var(--ink);
    font-weight: 500;
    white-space: nowrap;
    flex: none;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      0 2px 0 var(--plate-lo);
    transition:
      transform 0.08s,
      box-shadow 0.08s,
      background-color 0.15s,
      color 0.15s;
  }

  .pk-copy--sm {
    min-height: 1.75rem;
    padding: 0 0.625rem;
    font-size: 0.75rem;
  }
  .pk-copy--md {
    min-height: 2rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
  }

  .pk-copy:hover:not(:disabled) {
    background: color-mix(in oklab, var(--plate-raised), var(--ink) 8%);
  }

  .pk-copy:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: inset 0 1px 0 var(--plate-hi);
  }

  .pk-copy[data-copied='true'] {
    color: var(--mint);
  }

  .pk-copy:disabled {
    color: var(--ink-3);
    cursor: not-allowed;
  }
</style>
