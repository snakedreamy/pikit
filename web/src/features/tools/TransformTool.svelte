<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CodeBlock, Field, TextArea } from '../../ui';

  interface Props {
    inputLabel: string;
    outputLabel: string;
    outputCodeLabel?: string;
    value: string;
    output: string;
    placeholder?: string;
    error?: string;
    inputMeta?: string;
    outputMeta?: string;
    controls?: Snippet;
  }

  let {
    inputLabel,
    outputLabel,
    outputCodeLabel,
    value = $bindable(''),
    output,
    placeholder = '',
    error,
    inputMeta,
    outputMeta,
    controls,
  }: Props = $props();
</script>

<div class="xf-bench">
  {#if controls}
    <div class="xf-bench__bar">
      {@render controls()}
    </div>
  {/if}

  <div class="xf-bench__panes">
    <Field
      label={inputLabel}
      forId="pk-xf-input"
      meta={inputMeta}
      {error}
      stretch
    >
      <TextArea
        id="pk-xf-input"
        bind:value
        {placeholder}
        rows={9}
        mono
        invalid={Boolean(error)}
      />
    </Field>

    <Field
      label={outputLabel}
      meta={outputMeta}
      stretch
    >
      <CodeBlock code={output} label={outputCodeLabel} wrap fillHeight />
    </Field>
  </div>
</div>

<style>
  .xf-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .xf-bench__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.875rem;
    border-bottom: 1px solid var(--hairline);
  }

  /* Symmetric two-pane workbench: equal-width, equal-height input (left) and output (right) wells */
  .xf-bench__panes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.125rem;
    align-items: stretch;
  }

  @media (max-width: 860px) {
    .xf-bench__panes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
