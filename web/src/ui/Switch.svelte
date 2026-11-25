<script lang="ts">
  interface Props {
    checked?: boolean;
    label?: string;
    ariaLabel?: string;
    description?: string;
    id?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    label,
    ariaLabel,
    description,
    id,
    disabled = false,
    onchange,
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<div class="pk-switch-row" data-disabled={disabled ? 'true' : undefined}>
  <button
    {id}
    type="button"
    role="switch"
    class="pk-switch"
    aria-checked={checked ? 'true' : 'false'}
    aria-label={ariaLabel ?? label}
    {disabled}
    onclick={toggle}
  >
    <span class="pk-switch__thumb" aria-hidden="true"></span>
  </button>
  {#if label || description}
    <div class="pk-switch__text" onclick={toggle} role="presentation">
      {#if label}
        <span class="pk-switch__label" data-on={checked ? 'true' : undefined}>{label}</span>
      {/if}
      {#if description}
        <span class="pk-switch__desc">{description}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pk-switch-row {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
  }
  .pk-switch-row[data-disabled='true'] {
    opacity: 0.5;
  }

  .pk-switch {
    position: relative;
    flex: none;
    width: 2.75rem;
    height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: 0.75rem;
    background: var(--glass);
    box-shadow:
      inset 0 0 0 1px var(--glass-edge),
      inset 0 2px 4px var(--glass-shadow),
      0 1px 0 var(--plate-hi);
    transition: background-color 0.2s;
  }

  .pk-switch__thumb {
    position: absolute;
    top: 0.1875rem;
    left: 0.1875rem;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
    background: var(--ink-3);
    transition:
      transform 0.2s var(--ease-out),
      background-color 0.2s;
  }

  .pk-switch[aria-checked='true'] {
    background: color-mix(in oklab, var(--glass), var(--amber) 26%);
  }

  .pk-switch[aria-checked='true'] .pk-switch__thumb {
    transform: translateX(1.25rem);
    background: var(--amber);
    box-shadow: 0 0 0.5rem var(--amber-glow);
  }

  .pk-switch__text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    cursor: pointer;
    user-select: none;
  }

  .pk-switch__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--ink-2);
  }
  .pk-switch__label[data-on='true'] {
    color: var(--ink);
  }

  .pk-switch__desc {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
</style>
