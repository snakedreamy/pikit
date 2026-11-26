import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'bcrypt',
  category: 'crypto',
  order: 112,
  icon: 'lock-keyhole',
  badge: 'Eksblowfish',
  load: () => import('./Tool.svelte'),
};
