<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    checked?: boolean;
    label: string;
    description?: string;
    id?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    label,
    description,
    id,
    disabled = false,
    onchange,
  }: Props = $props();

  function handleChange(e: Event) {
    const next = (e.currentTarget as HTMLInputElement).checked;
    checked = next;
    onchange?.(next);
  }
</script>

<label class="pk-check" data-disabled={disabled ? 'true' : undefined} for={id}>
  <span class="pk-check__box-wrap">
    <input
      {id}
      type="checkbox"
      class="pk-check__native sr-only"
      {checked}
      {disabled}
      onchange={handleChange}
    />
    <span class="glass pk-check__box" data-checked={checked ? 'true' : undefined} aria-hidden="true">
      {#if checked}
        <Icon name="check" size="xs" />
      {/if}
    </span>
  </span>
  <span class="pk-check__text">
    <span class="pk-check__label">{label}</span>
    {#if description}
      <span class="pk-check__desc">{description}</span>
    {/if}
  </span>
</label>

<style>
  .pk-check {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    cursor: pointer;
    user-select: none;
  }
  .pk-check[data-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pk-check__box-wrap {
    position: relative;
    display: inline-flex;
  }

  .pk-check__box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.25rem;
    color: var(--ink-on-amber);
  }

  .pk-check__box[data-checked='true'] {
    background: var(--amber);
    box-shadow: 0 0 0.45rem var(--amber-glow);
  }

  .pk-check__native:focus-visible + .pk-check__box {
    outline: 2px solid var(--mint);
    outline-offset: 2px;
  }

  .pk-check__text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .pk-check__label {
    font-size: 0.875rem;
    color: var(--ink);
  }

  .pk-check__desc {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
</style>
