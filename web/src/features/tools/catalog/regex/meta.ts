import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'regex',
  category: 'text',
  order: 130,
  icon: 'regex',
  badge: 'RegExp',
  load: () => import('./Tool.svelte'),
};
