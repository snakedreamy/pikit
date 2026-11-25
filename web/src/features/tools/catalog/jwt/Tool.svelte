<script lang="ts">
  import { formatDateTime, t } from '../../../../lib/i18n/index.svelte';
  import { Badge, CodeBlock, Field, TextArea } from '../../../../ui';
  import { inspectJwtToken } from './logic';

  const NS = 'tool:jwt';

  let raw = $state(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwaWtpdC1hZG1pbiIsImlhdCI6MTc2MzgwMDAwMCwiZXhwIjoxODk5OTk5OTk5fQ.signature_placeholder'
  );

  const decoded = $derived(inspectJwtToken(raw));
</script>

<div class="jwt-bench">
  <Field
    label={t('inputLabel', undefined, NS)}
    forId="pk-jwt-in"
    error={!decoded.ok ? t('invalid', undefined, NS) : undefined}
  >
    <TextArea id="pk-jwt-in" bind:value={raw} rows={3} mono invalid={!decoded.ok} />
  </Field>

  {#if decoded.ok && decoded.headerJson}
    <div class="jwt-meta">
      {#if decoded.claims.alg}
        <Badge tone="neutral">alg: {decoded.claims.alg}</Badge>
      {/if}
      {#if decoded.claims.iatMs !== undefined}
        <Badge tone="neutral">
          {t('iatMeta', { time: formatDateTime(decoded.claims.iatMs) }, NS)}
        </Badge>
      {/if}
      {#if decoded.claims.expMs !== undefined}
        <Badge tone={decoded.claims.expired ? 'danger' : 'success'} dot>
          {t(
            decoded.claims.expired ? 'statusExpired' : 'statusValid',
            { time: formatDateTime(decoded.claims.expMs) },
            NS
          )}
        </Badge>
      {/if}
    </div>

    <div class="jwt-panes">
      <Field label={t('headerLabel', undefined, NS)} stretch>
        <CodeBlock code={decoded.headerJson} label="Header" fillHeight />
      </Field>
      <Field label={t('payloadLabel', undefined, NS)} stretch>
        <CodeBlock code={decoded.payloadJson} label="Payload" fillHeight />
      </Field>
    </div>
  {/if}
</div>

<style>
  .jwt-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .jwt-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .jwt-panes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.125rem;
    align-items: stretch;
  }

  @media (max-width: 820px) {
    .jwt-panes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
