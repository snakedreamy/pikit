import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'token',
  category: 'crypto',
  order: 100,
  icon: 'key-round',
  badge: 'Entropy',
  load: () => import('./Tool.svelte'),
};
