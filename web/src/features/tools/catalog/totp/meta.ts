import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'totp',
  category: 'tokens',
  order: 115,
  icon: 'timer',
  badge: 'RFC 6238',
  load: () => import('./Tool.svelte'),
};
