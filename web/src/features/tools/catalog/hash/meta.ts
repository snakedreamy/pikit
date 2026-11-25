import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'hash',
  category: 'crypto',
  order: 70,
  icon: 'fingerprint',
  badge: 'SHA / MD5',
  load: () => import('./Tool.svelte'),
};
