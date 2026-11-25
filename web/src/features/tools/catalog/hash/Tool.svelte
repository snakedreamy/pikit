<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { CopyButton, Field, Segmented, TextArea } from '../../../../ui';
  import { computeAllHashes, type AllHashes, type DigestEncoding } from './logic';

  const NS = 'tool:hash';

  let input = $state('pikbay');
  let encoding = $state<DigestEncoding>('hex');
  let digests = $state<AllHashes | null>(null);

  $effect(() => {
    const text = input;
    const enc = encoding;
    let stale = false;
    computeAllHashes(text, enc).then((res) => {
      if (!stale) digests = res;
    });
    return () => {
      stale = true;
    };
  });
</script>

<div class="hash-bench">
  <div class="hash-bar">
    <Segmented
      size="sm"
      ariaLabel="Encoding"
      bind:value={encoding}
      options={[
        { value: 'hex', label: t('fmtHex', undefined, NS) },
        { value: 'base64', label: t('fmtBase64', undefined, NS) },
      ]}
    />
  </div>

  <Field label={t('inputLabel', undefined, NS)} forId="pk-hash-in">
    <TextArea id="pk-hash-in" bind:value={input} rows={4} mono />
  </Field>

  {#if digests}
    {@const items = [
      { alg: 'MD5', val: digests.md5 },
      { alg: 'SHA-1', val: digests.sha1 },
      { alg: 'SHA-256', val: digests.sha256 },
      { alg: 'SHA-384', val: digests.sha384 },
      { alg: 'SHA-512', val: digests.sha512 },
    ]}
    <dl class="glass hash-list">
      {#each items as item (item.alg)}
        <div class="hash-row">
          <dt class="mono">{item.alg}</dt>
          <dd class="mono">{item.val}</dd>
          <CopyButton text={item.val} />
        </div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .hash-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .hash-bar {
    display: flex;
    justify-content: flex-end;
  }

  .hash-list {
    margin: 0;
    padding: 0.25rem 0.875rem;
  }

  .hash-row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0;
  }

  .hash-row + .hash-row {
    border-top: 1px solid var(--hairline);
  }

  .hash-row dt {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .hash-row dd {
    font-size: 0.8125rem;
    color: var(--mint);
    word-break: break-all;
  }

  @media (max-width: 680px) {
    .hash-row {
      grid-template-columns: 1fr auto;
    }
    .hash-row dd {
      grid-column: 1 / -1;
      order: 3;
    }
  }
</style>
