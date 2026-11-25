<script lang="ts">
  interface Props {
    value?: string;
    id?: string;
    rows?: number;
    placeholder?: string;
    mono?: boolean;
    invalid?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    oninput?: (e: Event) => void;
  }

  let {
    value = $bindable(''),
    id,
    rows = 4,
    placeholder = '',
    mono = false,
    invalid = false,
    disabled = false,
    readonly = false,
    oninput,
  }: Props = $props();
</script>

<textarea
  {id}
  {rows}
  class="glass pk-textarea"
  class:mono
  bind:value
  {placeholder}
  {disabled}
  {readonly}
  spellcheck={mono ? 'false' : undefined}
  aria-invalid={invalid ? 'true' : undefined}
  {oninput}
></textarea>

<style>
  .pk-textarea {
    display: block;
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 0;
    color: var(--ink);
    font-size: 0.875rem;
    line-height: 1.55;
    resize: vertical;
  }

  .pk-textarea.mono {
    font-size: 0.8125rem;
  }

  .pk-textarea[aria-invalid='true'] {
    box-shadow:
      inset 0 0 0 1px var(--fault),
      inset 0 2px 5px var(--glass-shadow);
  }

  .pk-textarea::placeholder {
    color: var(--ink-3);
  }

  .pk-textarea:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
