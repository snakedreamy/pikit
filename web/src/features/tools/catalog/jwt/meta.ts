import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'jwt',
  category: 'crypto',
  order: 110,
  icon: 'file-key-2',
  badge: 'JWT',
  load: () => import('./Tool.svelte'),
};
