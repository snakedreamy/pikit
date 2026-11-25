import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'base64',
  category: 'encoding',
  order: 10,
  icon: 'file-code-2',
  badge: 'Base64',
  load: () => import('./Tool.svelte'),
};
