<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg';
  }

  let { size = 'md' }: Props = $props();
</script>

<!-- pikbay "Stencil P-Core" transparent-background geometric brand mark -->
<svg
  class="pk-brand-mark pk-brand-mark--{size}"
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  focusable="false"
>
  <rect x="2.5" y="2" width="4.5" height="20" rx="1.4" class="pk-brand-mark__ink" />
  <path
    d="M9.9 2H15A6.5 6.5 0 0 1 15 15H9.9A0.9 0.9 0 0 1 9 14.1V11.5A0.9 0.9 0 0 1 9.9 10.6H14.8A2.1 2.1 0 0 0 14.8 6.4H9.9A0.9 0.9 0 0 1 9 5.5V2.9A0.9 0.9 0 0 1 9.9 2Z"
    class="pk-brand-mark__ink"
  />
  <circle cx="11.25" cy="19.75" r="2.25" class="pk-brand-mark__amber" />
  <rect x="15.5" y="17.5" width="6" height="4.5" rx="1.4" class="pk-brand-mark__mint" />
</svg>

<style>
  .pk-brand-mark {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }

  .pk-brand-mark--sm {
    width: 1.125rem;
    height: 1.125rem;
  }

  .pk-brand-mark--md {
    width: 1.375rem;
    height: 1.375rem;
  }

  .pk-brand-mark--lg {
    width: 1.75rem;
    height: 1.75rem;
  }

  .pk-brand-mark__ink {
    fill: var(--ink);
  }

  .pk-brand-mark__amber {
    fill: var(--amber);
  }

  .pk-brand-mark__mint {
    fill: var(--mint);
  }
</style>
