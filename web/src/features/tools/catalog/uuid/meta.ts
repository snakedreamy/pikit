import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'uuid',
  category: 'crypto',
  order: 90,
  icon: 'scan-barcode',
  badge: 'RFC 9562',
  load: () => import('./Tool.svelte'),
};
