<script lang="ts">
  import { formatBytes, t } from '../../../../lib/i18n/index.svelte';
  import { Button, Segmented } from '../../../../ui';
  import TransformTool from '../../TransformTool.svelte';
  import {
    decodeBase64Payload,
    encodeBytesBase64,
    encodeUtf8Base64,
    type DecodedBase64Payload,
    type Base64Variant,
  } from './logic';

  const NS = 'tool:base64';

  let mode = $state<'encode' | 'decode'>('encode');
  let variant = $state<Base64Variant>('urlsafe');
  let input = $state('https://media.example.ts.net/api/healthz');
  let fileBytes = $state<Uint8Array | null>(null);
  let fileName = $state('');
  let fileInputEl: HTMLInputElement | undefined = $state();
  let fileReadSeq = 0;

  // Release any selected binary buffer and invalidate in-flight `FileReader` loads when switching to decode or editing text
  $effect(() => {
    if (mode === 'decode' || (fileBytes && input !== `[${fileName}]`)) {
      fileReadSeq += 1;
      if (fileBytes) {
        fileBytes = null;
        fileName = '';
        if (mode === 'decode' && input.startsWith('[') && input.endsWith(']')) {
          input = '';
        }
      }
    }
  });

  const computed = $derived.by((): DecodedBase64Payload => {
    if (mode === 'encode') {
      if (fileBytes) {
        return {
          ok: true,
          output: encodeBytesBase64(fileBytes, variant),
          byteLength: fileBytes.byteLength,
          decodedBytes: null,
        };
      }
      return { ...encodeUtf8Base64(input, variant), decodedBytes: null };
    }
    return decodeBase64Payload(input);
  });

  const decodedBinary = $derived(mode === 'decode' ? computed.decodedBytes : null);

  function handleFileSelected(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const seq = ++fileReadSeq;
    const reader = new FileReader();
    reader.onload = () => {
      if (seq !== fileReadSeq) return;
      if (reader.result instanceof ArrayBuffer) {
        fileBytes = new Uint8Array(reader.result);
        fileName = file.name;
        input = `[${file.name}]`;
        mode = 'encode';
      }
    };
    reader.readAsArrayBuffer(file);
    target.value = '';
  }

  function downloadBinary() {
    if (!decodedBinary || decodedBinary.length === 0) return;
    const copy = new Uint8Array(decodedBinary.byteLength);
    copy.set(decodedBinary);
    const blob = new Blob([copy], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decoded.bin';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<input
  bind:this={fileInputEl}
  type="file"
  class="sr-only"
  onchange={handleFileSelected}
/>

<TransformTool
  inputLabel={mode === 'encode' ? t('inputEncode', undefined, NS) : t('inputDecode', undefined, NS)}
  outputLabel={t('outputLabel', undefined, NS)}
  outputCodeLabel={mode === 'encode' ? (variant === 'urlsafe' ? 'Base64URL' : 'Base64') : 'UTF-8'}
  bind:value={input}
  output={computed.output}
  placeholder={mode === 'encode'
    ? t('placeholderEncode', undefined, NS)
    : t('placeholderDecode', undefined, NS)}
  error={computed.ok ? undefined : t('invalidBase64', undefined, NS)}
  inputMeta={fileBytes ? `${fileName} · ${formatBytes(fileBytes.byteLength)}` : t('chars', { count: input.length }, NS)}
  outputMeta={t('bytes', { count: computed.byteLength }, NS)}
>
  {#snippet controls()}
    <div class="b64-left">
      <Segmented
        size="sm"
        ariaLabel="Mode"
        bind:value={mode}
        options={[
          { value: 'encode', label: t('modeEncode', undefined, NS) },
          { value: 'decode', label: t('modeDecode', undefined, NS) },
        ]}
      />

      {#if mode === 'encode'}
        <Button variant="secondary" size="sm" onclick={() => fileInputEl?.click()}>
          {t('pickFile', undefined, NS)}
        </Button>
        {#if fileBytes}
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              fileReadSeq += 1;
              fileBytes = null;
              fileName = '';
            }}
          >
            {t('common.clear')}
          </Button>
        {/if}
      {:else if decodedBinary && decodedBinary.length > 0}
        <Button variant="secondary" size="sm" onclick={downloadBinary}>
          {t('downloadDecoded', undefined, NS)}
        </Button>
      {/if}
    </div>

    {#if mode === 'encode'}
      <Segmented
        size="sm"
        ariaLabel="Variant"
        bind:value={variant}
        options={[
          { value: 'standard', label: t('variantStandard', undefined, NS) },
          { value: 'urlsafe', label: t('variantUrlSafe', undefined, NS) },
        ]}
      />
    {/if}
  {/snippet}
</TransformTool>

<style>
  .b64-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
</style>
