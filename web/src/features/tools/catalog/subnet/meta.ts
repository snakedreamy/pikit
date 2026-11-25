import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'subnet',
  category: 'network',
  order: 150,
  icon: 'network',
  badge: 'CIDR',
  load: () => import('./Tool.svelte'),
};
