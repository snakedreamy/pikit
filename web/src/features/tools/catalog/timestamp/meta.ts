import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'timestamp',
  category: 'encoding',
  order: 40,
  icon: 'clock',
  badge: 'Epoch',
  load: () => import('./Tool.svelte'),
};
