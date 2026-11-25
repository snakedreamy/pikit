<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, Checkbox, CodeBlock, Field, Input, Select } from '../../../../ui';
  import { generateTokens } from './logic';

  const NS = 'tool:token';

  let lengthStr = $state('32');
  let countStr = $state('4');
  let uppercase = $state(true);
  let lowercase = $state(true);
  let digits = $state(true);
  let symbols = $state(false);
  let excludeAmbiguous = $state(true);
  let nonce = $state(0);

  const result = $derived.by(() => {
    void nonce;
    return generateTokens({
      length: Number(lengthStr) || 32,
      count: Number(countStr) || 4,
      uppercase,
      lowercase,
      digits,
      symbols,
      excludeAmbiguous,
    });
  });

  const strengthTone = $derived(
    result.entropyBits >= 128 ? 'success' : result.entropyBits >= 72 ? 'warning' : 'danger'
  );
</script>

<div class="tk-bench">
  <div class="tk-top">
    <Field label={t('lengthLabel', undefined, NS)} forId="pk-tk-len">
      <Input id="pk-tk-len" type="number" bind:value={lengthStr} mono />
    </Field>

    <Field label={t('countLabel', undefined, NS)} forId="pk-tk-cnt">
      <Select
        id="pk-tk-cnt"
        bind:value={countStr}
        options={[
          { value: '1', label: '× 1' },
          { value: '4', label: '× 4' },
          { value: '8', label: '× 8' },
          { value: '16', label: '× 16' },
        ]}
      />
    </Field>

    <div class="tk-top__act">
      {#if result.poolSize > 0}
        <Badge tone={strengthTone} dot>
          {t('entropyMeta', { pool: result.poolSize, bits: result.entropyBits }, NS)}
        </Badge>
      {/if}
      <Button variant="primary" size="sm" onclick={() => (nonce += 1)}>
        {t('regenerate', undefined, NS)}
      </Button>
    </div>
  </div>

  <div class="tk-checks">
    <Checkbox bind:checked={uppercase} label={t('upper', undefined, NS)} />
    <Checkbox bind:checked={lowercase} label={t('lower', undefined, NS)} />
    <Checkbox bind:checked={digits} label={t('digits', undefined, NS)} />
    <Checkbox bind:checked={symbols} label={t('symbols', undefined, NS)} />
    <Checkbox bind:checked={excludeAmbiguous} label={t('noAmbiguous', undefined, NS)} />
  </div>

  {#if result.poolSize === 0}
    <p class="tk-err">{t('emptyPool', undefined, NS)}</p>
  {:else}
    <CodeBlock code={result.tokens.join('\n')} label="CSPRNG" />
  {/if}
</div>

<style>
  .tk-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .tk-top {
    display: grid;
    grid-template-columns: 9rem 8rem minmax(0, 1fr);
    align-items: end;
    gap: 0.875rem;
  }

  .tk-top__act {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .tk-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.625rem 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }

  .tk-err {
    font-size: 0.8125rem;
    color: var(--fault);
  }

  @media (max-width: 720px) {
    .tk-top {
      grid-template-columns: 1fr 1fr;
    }
    .tk-top__act {
      grid-column: 1 / -1;
      justify-content: space-between;
    }
  }
</style>
