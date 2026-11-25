<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Field, TextArea } from '../../../../ui';
  import { diffTexts } from './logic';

  const NS = 'tool:text-diff';

  let left = $state('listen = "0.0.0.0:8080"\nmax_upload_mb = 32\nenabled = true');
  let right = $state('listen = "127.0.0.1:8080"\nmax_upload_mb = 64\nenabled = true\nper_core = true');

  const diff = $derived(diffTexts(left, right));
</script>

<div class="df-bench">
  <div class="df-inputs">
    <Field label={t('leftLabel', undefined, NS)} forId="pk-df-left">
      <TextArea id="pk-df-left" bind:value={left} rows={6} mono />
    </Field>
    <Field label={t('rightLabel', undefined, NS)} forId="pk-df-right">
      <TextArea id="pk-df-right" bind:value={right} rows={6} mono />
    </Field>
  </div>

  <div class="df-head">
    <span class="df-head__label">{t('resultLabel', undefined, NS)}</span>
    <div class="df-head__badges">
      {#if diff.approximated}
        <Badge tone="warning">{t('approximatedNotice', undefined, NS)}</Badge>
      {/if}
      {#if diff.added === 0 && diff.removed === 0}
        <Badge tone="success" dot>{t('identical', undefined, NS)}</Badge>
      {:else}
        <Badge tone="warning">
          {t('stats', { added: diff.added, removed: diff.removed }, NS)}
        </Badge>
      {/if}
    </div>
  </div>

  <div class="glass df-view mono">
    {#each diff.lines as ln, idx (idx)}
      <div class="df-line" data-kind={ln.kind}>
        <span class="df-line__num">{ln.oldLineNo ?? ''}</span>
        <span class="df-line__num">{ln.newLineNo ?? ''}</span>
        <span class="df-line__sig">
          {ln.kind === 'insert' ? '+' : ln.kind === 'delete' ? '-' : ' '}
        </span>
        <span class="df-line__code">
          {#if ln.inline}
            {#each ln.inline as seg, sIdx (sIdx)}
              <span class="df-seg" data-seg={seg.kind}>{seg.text}</span>
            {/each}
          {:else}
            {ln.text}
          {/if}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .df-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .df-inputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .df-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .df-head__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .df-head__badges {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .df-view {
    padding: 0.375rem 0;
    overflow-x: auto;
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .df-line {
    display: grid;
    grid-template-columns: 2.5rem 2.5rem 1.25rem minmax(0, 1fr);
    padding: 0.0625rem 0.75rem;
    white-space: pre;
  }

  .df-line[data-kind='insert'] {
    background: var(--mint-soft);
    color: var(--mint);
  }

  .df-line[data-kind='delete'] {
    background: var(--fault-soft);
    color: var(--fault);
  }

  .df-line__num {
    color: var(--ink-3);
    font-size: 0.6875rem;
    text-align: right;
    padding-right: 0.5rem;
    user-select: none;
  }

  .df-line__sig {
    user-select: none;
    font-weight: 700;
  }

  .df-seg[data-seg='insert'] {
    background: rgb(114 230 201 / 0.28);
    border-radius: 2px;
  }

  .df-seg[data-seg='delete'] {
    background: rgb(242 111 89 / 0.3);
    border-radius: 2px;
  }

  @media (max-width: 820px) {
    .df-inputs {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
