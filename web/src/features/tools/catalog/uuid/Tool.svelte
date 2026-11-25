<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, Checkbox, CodeBlock, Segmented, Select } from '../../../../ui';
  import { generateUuidBatch, type UuidVersion } from './logic';

  const NS = 'tool:uuid';

  let version = $state<UuidVersion>('v7');
  let countStr = $state('5');
  let uppercase = $state(false);
  let hyphens = $state(true);
  let nonce = $state(0);

  const output = $derived.by(() => {
    void nonce;
    return generateUuidBatch(version, Number(countStr) || 5, { uppercase, hyphens }).join('\n');
  });
</script>

<div class="uuid-bench">
  <div class="uuid-bar">
    <Segmented
      size="sm"
      ariaLabel="UUID Version"
      bind:value={version}
      options={[
        { value: 'v7', label: t('verV7', undefined, NS) },
        { value: 'v4', label: t('verV4', undefined, NS) },
      ]}
    />

    <div class="uuid-opts">
      <div class="uuid-count">
        <Select
          ariaLabel={t('countLabel', undefined, NS)}
          bind:value={countStr}
          options={[
            { value: '1', label: '× 1' },
            { value: '5', label: '× 5' },
            { value: '10', label: '× 10' },
            { value: '25', label: '× 25' },
            { value: '50', label: '× 50' },
          ]}
        />
      </div>
      <Checkbox bind:checked={uppercase} label={t('uppercase', undefined, NS)} />
      <Checkbox bind:checked={hyphens} label={t('hyphens', undefined, NS)} />
      <Button variant="primary" size="sm" onclick={() => (nonce += 1)}>
        {t('regenerate', undefined, NS)}
      </Button>
    </div>
  </div>

  <CodeBlock code={output} label={`UUID ${version.toUpperCase()}`} />
</div>

<style>
  .uuid-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .uuid-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
  }

  .uuid-opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.875rem;
  }

  .uuid-count {
    width: 6.25rem;
  }
</style>
