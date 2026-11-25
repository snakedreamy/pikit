import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'color',
  category: 'encoding',
  order: 60,
  icon: 'palette',
  badge: 'OKLCH',
  load: () => import('./Tool.svelte'),
};
