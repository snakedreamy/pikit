<script lang="ts">
  import spriteUrl from '../assets/icons-sprite.svg?url';
  import type { IconName } from '../icons/names';

  interface Props {
    name: IconName;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    label?: string;
  }

  let { name, size = 'md', label }: Props = $props();
</script>

<svg
  class="pk-icon pk-icon--{size}"
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
  role={label ? 'img' : undefined}
  focusable="false"
>
  <use href="{spriteUrl}#{name}" />
</svg>

<style>
  /* Even pixel sizing aligned with 24×24 viewBox and 1.5 stroke width (16/24 * 1.5 = 1.0px exact device pixel) */
  .pk-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
    color: currentColor;
  }
  .pk-icon--xs {
    width: 14px;
    height: 14px;
  }
  .pk-icon--sm {
    width: 16px;
    height: 16px;
  }
  .pk-icon--md {
    width: 18px;
    height: 18px;
  }
  .pk-icon--lg {
    width: 20px;
    height: 20px;
  }
</style>
