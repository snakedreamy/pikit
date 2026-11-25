import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'json-format',
  category: 'encoding',
  order: 30,
  icon: 'braces',
  badge: 'JSON',
  load: () => import('./Tool.svelte'),
};
