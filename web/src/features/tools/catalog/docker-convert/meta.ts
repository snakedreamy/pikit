import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'docker-convert',
  category: 'network',
  order: 180,
  icon: 'container',
  badge: 'Quadlet',
  load: () => import('./Tool.svelte'),
};
