<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, CodeBlock, Field, Input, Segmented, Select, TextArea } from '../../../../ui';
  import { decryptTextWithPassphrase, encryptTextWithPassphrase } from './logic';

  const NS = 'tool:text-encrypt';

  let mode = $state<'encrypt' | 'decrypt'>('encrypt');
  let passphrase = $state('pikbay-offline-vault-key');
  let kdfRoundsStr = $state('210000');
  let input = $state('[Peer]\nPublicKey = x9K3vL8mQ2pR7tW4zN1bC6fH0jD5sG8aE2yU4iO6pA8=\nPresharedKey = m7P2qW9xL4vK8nJ1rT5yB3cF6hD0gS9aZ2eU7iO4pQ1=');
  let output = $state('');
  let errorCode = $state<string | null>(null);
  let busy = $state(false);
  let runSeq = 0;

  async function executeCipher() {
    const seq = ++runSeq;
    busy = true;
    errorCode = null;
    const res =
      mode === 'encrypt'
        ? await encryptTextWithPassphrase(input, passphrase, Number(kdfRoundsStr) || 210_000)
        : await decryptTextWithPassphrase(input, passphrase);
    if (seq !== runSeq) return;
    busy = false;
    if (res.ok) {
      output = res.output;
    } else {
      output = '';
      errorCode = res.error;
    }
  }

  function switchMode(next: string) {
    const target = next === 'decrypt' ? 'decrypt' : 'encrypt';
    if (target === mode) return;
    mode = target;
    if (target === 'decrypt' && output.startsWith('PKB1.')) {
      input = output;
    }
    void executeCipher();
  }

  onMount(() => {
    void executeCipher();
  });
</script>

<div class="te-bench">
  <div class="te-top">
    <Segmented
      size="sm"
      ariaLabel="Mode"
      value={mode}
      onchange={switchMode}
      options={[
        { value: 'encrypt', label: t('modeEncrypt', undefined, NS) },
        { value: 'decrypt', label: t('modeDecrypt', undefined, NS) },
      ]}
    />

    <div class="te-top__pass">
      <Field label={t('passLabel', undefined, NS)} forId="pk-te-pass">
        <Input
          id="pk-te-pass"
          type="password"
          bind:value={passphrase}
          placeholder={t('passPlaceholder', undefined, NS)}
          mono
        />
      </Field>
    </div>

    {#if mode === 'encrypt'}
      <div class="te-top__kdf">
        <Field label={t('kdfLabel', undefined, NS)} forId="pk-te-kdf">
          <Select
            name="te-kdf"
            ariaLabel={t('kdfLabel', undefined, NS)}
            bind:value={kdfRoundsStr}
            options={[
              { value: '100000', label: '100,000' },
              { value: '210000', label: '210,000 (OWASP)' },
              { value: '600000', label: '600,000 (High)' },
            ]}
          />
        </Field>
      </div>
    {/if}

    <Button variant="primary" onclick={executeCipher} disabled={busy}>
      {mode === 'encrypt' ? t('runEncrypt', undefined, NS) : t('runDecrypt', undefined, NS)}
    </Button>
  </div>

  <Field
    label={mode === 'encrypt' ? t('inputPlain', undefined, NS) : t('inputCipher', undefined, NS)}
    forId="pk-te-input"
    error={errorCode ? t(`errors.${errorCode}`, undefined, NS) : undefined}
  >
    <TextArea id="pk-te-input" bind:value={input} rows={5} mono />
  </Field>

  {#if output}
    <CodeBlock
      label={mode === 'encrypt' ? t('outputCipher', undefined, NS) : t('outputPlain', undefined, NS)}
      code={output}
      wrap
    />
  {/if}
</div>

<style>
  .te-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .te-top {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .te-top__pass {
    flex: 1;
    min-width: 14rem;
  }

  .te-top__kdf {
    width: 11.5rem;
  }
</style>
