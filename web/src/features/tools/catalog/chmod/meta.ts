import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'chmod',
  category: 'network',
  order: 175,
  icon: 'terminal',
  badge: 'POSIX',
  load: () => import('./Tool.svelte'),
};
