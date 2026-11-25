import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'text-case',
  category: 'text',
  order: 140,
  icon: 'case-sensitive',
  badge: 'Case',
  load: () => import('./Tool.svelte'),
};
