import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'base-convert',
  category: 'encoding',
  order: 50,
  icon: 'binary',
  badge: 'Radix',
  load: () => import('./Tool.svelte'),
};
