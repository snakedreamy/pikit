import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'hmac',
  category: 'crypto',
  order: 80,
  icon: 'shield-check',
  badge: 'HMAC',
  load: () => import('./Tool.svelte'),
};
