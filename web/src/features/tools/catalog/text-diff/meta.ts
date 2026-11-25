import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'text-diff',
  category: 'text',
  order: 120,
  icon: 'git-compare-arrows',
  badge: 'Myers',
  load: () => import('./Tool.svelte'),
};
