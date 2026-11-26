import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'url-parser',
  category: 'web',
  order: 210,
  icon: 'globe',
  badge: 'RFC 3986',
  load: () => import('./Tool.svelte'),
};
