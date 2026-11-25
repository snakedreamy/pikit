import type { ToolMeta } from '../../types';

export const toolMeta: ToolMeta = {
  id: 'qrcode',
  category: 'network',
  order: 170,
  icon: 'qr-code',
  badge: 'QR',
  load: () => import('./Tool.svelte'),
};
