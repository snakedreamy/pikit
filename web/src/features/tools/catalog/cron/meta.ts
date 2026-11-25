import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'cron',
  category: 'network',
  order: 160,
  icon: 'calendar-clock',
  badge: 'Cron',
  load: () => import('./Tool.svelte'),
};
