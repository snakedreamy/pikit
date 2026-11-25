<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Segmented } from '../../../../ui';
  import TransformTool from '../../TransformTool.svelte';
  import { formatJsonText, type JsonIndent } from './logic';

  const NS = 'tool:json-format';

  let indent = $state<JsonIndent>('2');
  let input = $state('{"service":"pikbay","version":1,"features":{"speedtest":true,"tools":17}}');

  const res = $derived(formatJsonText(input, indent));
  const errText = $derived(
    res.ok
      ? undefined
      : t(
          'errorAt',
          {
            line: res.errorLine ?? 1,
            column: res.errorColumn ?? 1,
            message: res.errorMessage ?? '',
          },
          NS
        )
  );
</script>

<TransformTool
  inputLabel={t('inputLabel', undefined, NS)}
  outputLabel={t('outputLabel', undefined, NS)}
  outputCodeLabel="JSON"
  bind:value={input}
  output={res.output}
  error={errText}
>
  {#snippet controls()}
    <Segmented
      size="sm"
      ariaLabel="Indent"
      bind:value={indent}
      options={[
        { value: '2', label: t('indent2', undefined, NS) },
        { value: '4', label: t('indent4', undefined, NS) },
        { value: 'tab', label: t('indentTab', undefined, NS) },
        { value: 'minify', label: t('minify', undefined, NS) },
      ]}
    />
  {/snippet}
</TransformTool>
