import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'url-codec',
  category: 'encoding',
  order: 20,
  icon: 'link-2',
  badge: 'URI',
  load: () => import('./Tool.svelte'),
};
