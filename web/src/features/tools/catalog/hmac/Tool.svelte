<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Field, Input, Segmented, Select } from '../../../../ui';
  import TransformTool from '../../TransformTool.svelte';
  import {
    computeHmac,
    type HmacAlgorithm,
    type HmacKeyFormat,
    type HmacOutFormat,
  } from './logic';

  const NS = 'tool:hmac';

  let alg = $state<HmacAlgorithm>('SHA-256');
  let keyFmt = $state<HmacKeyFormat>('utf8');
  let outFmt = $state<HmacOutFormat>('hex');
  let secret = $state('');
  let secretTouched = $state(false);
  let message = $state('timestamp=1700000000&node=gw');
  let output = $state('');
  let errKey = $state<'empty_key' | 'invalid_hex_key' | undefined>(undefined);

  $effect(() => {
    const m = message;
    const s = secret;
    const a = alg;
    const kf = keyFmt;
    const of = outFmt;
    let stale = false;
    computeHmac(m, s, a, kf, of).then((res) => {
      if (stale) return;
      output = res.output;
      errKey = res.error;
    });
    return () => {
      stale = true;
    };
  });

  const errText = $derived(
    errKey === 'empty_key' && secretTouched
      ? t('errEmptyKey', undefined, NS)
      : errKey === 'invalid_hex_key'
        ? t('errHexKey', undefined, NS)
        : undefined
  );
</script>

<div class="hmac-wrap">
  <Field label={t('secretLabel', undefined, NS)} forId="pk-hmac-key" error={errText}>
    <Input
      id="pk-hmac-key"
      bind:value={secret}
      placeholder={t('errEmptyKey', undefined, NS)}
      mono
      invalid={Boolean(errText)}
      oninput={() => (secretTouched = true)}
    />
  </Field>

  <TransformTool
    inputLabel={t('inputLabel', undefined, NS)}
    outputLabel={t('outputLabel', undefined, NS)}
    outputCodeLabel={`HMAC-${alg}`}
    bind:value={message}
    {output}
  >
    {#snippet controls()}
      <div class="hmac-alg">
        <Select
          ariaLabel="HMAC Algorithm"
          bind:value={alg}
          options={[
            { value: 'SHA-256', label: 'HMAC-SHA-256' },
            { value: 'SHA-512', label: 'HMAC-SHA-512' },
            { value: 'SHA-384', label: 'HMAC-SHA-384' },
            { value: 'SHA-1', label: 'HMAC-SHA-1' },
          ]}
        />
      </div>
      <Segmented
        size="sm"
        ariaLabel="Key format"
        bind:value={keyFmt}
        options={[
          { value: 'utf8', label: t('keyUtf8', undefined, NS) },
          { value: 'hex', label: t('keyHex', undefined, NS) },
        ]}
      />
      <Segmented
        size="sm"
        ariaLabel="Output format"
        bind:value={outFmt}
        options={[
          { value: 'hex', label: t('outHex', undefined, NS) },
          { value: 'base64', label: t('outBase64', undefined, NS) },
        ]}
      />
    {/snippet}
  </TransformTool>
</div>

<style>
  .hmac-wrap {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .hmac-alg {
    width: 11rem;
  }
</style>
