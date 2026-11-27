import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'device-info',
  category: 'web',
  order: 220,
  icon: 'cpu',
  badge: 'Client',
  load: () => import('./Tool.svelte'),
};
