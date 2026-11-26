<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Segmented, Select } from '../../../../ui';
  import TransformTool from '../../TransformTool.svelte';
  import {
    convertStructuredData,
    type DataFormat,
    type SourceFormatOption,
  } from './logic';

  const NS = 'tool:data-convert';

  let sourceFormat = $state<SourceFormatOption>('auto');
  let targetFormat = $state<DataFormat>('yaml');
  let indentStr = $state<'2' | '4'>('2');
  let input = $state(`version = 1

[server]
listen = "127.0.0.1:8080"
trusted_proxies = ["127.0.0.1/32", "::1/128"]

[drop]
enabled = true
code_ttl_seconds = 180`);

  const result = $derived(
    convertStructuredData(input, sourceFormat, targetFormat, indentStr === '4' ? 4 : 2)
  );

  const detectedUpper = $derived(result.detectedSource.toUpperCase());
  const targetUpper = $derived(targetFormat.toUpperCase());

  const errorText = $derived.by(() => {
    if (result.ok) return undefined;
    if (result.location) {
      return t(
        'syntaxErrorAt',
        { line: result.location.line, col: result.location.column, msg: result.error },
        NS
      );
    }
    return result.error;
  });
</script>

<TransformTool
  inputLabel={t('inputLabel', { fmt: detectedUpper }, NS)}
  outputLabel={t('outputLabel', { fmt: targetUpper }, NS)}
  outputCodeLabel={targetUpper}
  bind:value={input}
  output={result.ok ? result.output : ''}
  error={errorText}
>
  {#snippet controls()}
    <div class="dc-controls">
      <div class="dc-select">
        <Select
          name="dc-src"
          ariaLabel={t('sourceFormat', undefined, NS)}
          bind:value={sourceFormat}
          options={[
            { value: 'auto', label: t('autoDetect', { detected: detectedUpper }, NS) },
            { value: 'yaml', label: 'YAML' },
            { value: 'json', label: 'JSON' },
            { value: 'toml', label: 'TOML' },
          ]}
        />
      </div>

      <Segmented
        size="sm"
        ariaLabel={t('targetFormat', undefined, NS)}
        bind:value={targetFormat}
        options={[
          { value: 'yaml', label: '→ YAML' },
          { value: 'json', label: '→ JSON' },
          { value: 'toml', label: '→ TOML' },
        ]}
      />
    </div>

    {#if targetFormat !== 'toml'}
      <Segmented
        size="sm"
        ariaLabel={t('indentLabel', undefined, NS)}
        bind:value={indentStr}
        options={[
          { value: '2', label: '2 sp' },
          { value: '4', label: '4 sp' },
        ]}
      />
    {/if}
  {/snippet}
</TransformTool>

<style>
  .dc-controls {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .dc-select {
    width: 11rem;
  }
</style>
