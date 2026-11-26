import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'data-convert',
  category: 'formats',
  order: 65,
  icon: 'arrow-right-left',
  badge: 'YAML · TOML',
  load: () => import('./Tool.svelte'),
};
