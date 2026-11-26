import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'text-encrypt',
  category: 'crypto',
  order: 114,
  icon: 'file-lock-2',
  badge: 'AES-256-GCM',
  load: () => import('./Tool.svelte'),
};
