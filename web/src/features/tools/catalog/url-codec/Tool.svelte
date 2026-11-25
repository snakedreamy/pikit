<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Segmented } from '../../../../ui';
  import TransformTool from '../../TransformTool.svelte';
  import { decodeUrlText, encodeUrlText, type UrlCodecMode } from './logic';

  const NS = 'tool:url-codec';

  let direction = $state<'encode' | 'decode'>('encode');
  let mode = $state<UrlCodecMode>('component');
  let input = $state('https://gw.example.ts.net/callback?next=/tools&name=edge node');

  const res = $derived(
    direction === 'encode'
      ? encodeUrlText(input, mode)
      : decodeUrlText(input, mode)
  );
</script>

<TransformTool
  inputLabel={t('inputLabel', undefined, NS)}
  outputLabel={t('outputLabel', undefined, NS)}
  outputCodeLabel={mode === 'component' ? 'URIComponent' : 'URI'}
  bind:value={input}
  output={res.output}
  error={res.ok ? undefined : t('invalidError', undefined, NS)}
>
  {#snippet controls()}
    <Segmented
      size="sm"
      ariaLabel="Direction"
      bind:value={direction}
      options={[
        { value: 'encode', label: t('encode', undefined, NS) },
        { value: 'decode', label: t('decode', undefined, NS) },
      ]}
    />
    <Segmented
      size="sm"
      ariaLabel="Scope"
      bind:value={mode}
      options={[
        { value: 'component', label: t('modeComponent', undefined, NS) },
        { value: 'uri', label: t('modeFullUri', undefined, NS) },
      ]}
    />
  {/snippet}
</TransformTool>
