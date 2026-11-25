<script lang="ts">
  import CopyButton from './CopyButton.svelte';

  interface Props {
    code: string;
    label?: string;
    meta?: string;
    copyable?: boolean;
    wrap?: boolean;
    fillHeight?: boolean;
  }

  let {
    code,
    label,
    meta,
    copyable = true,
    wrap = false,
    fillHeight = false,
  }: Props = $props();
</script>

<div class="glass pk-codeblock" data-fill={fillHeight ? 'true' : undefined}>
  {#if label || meta || copyable}
    <div class="pk-codeblock__bar">
      <div class="legend">
        {#if label}
          <span>{label}</span>
        {/if}
        {#if meta}
          <span class="legend__note">{meta}</span>
        {/if}
      </div>
      {#if copyable}
        <CopyButton text={code} />
      {/if}
    </div>
  {/if}
  <pre class="pk-codeblock__pre mono" class:pk-codeblock__pre--wrap={wrap}><code>{code}</code></pre>
</div>

<style>
  .pk-codeblock {
    overflow: hidden;
  }

  .pk-codeblock[data-fill='true'] {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .pk-codeblock[data-fill='true'] .pk-codeblock__pre {
    flex: 1;
  }

  .pk-codeblock__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--groove);
  }

  .pk-codeblock__pre {
    margin: 0;
    padding: 0.6875rem 0.75rem;
    overflow-x: auto;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--mint);
  }

  .pk-codeblock__pre--wrap {
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
