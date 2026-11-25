export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let nextId = 1;
let items = $state<ToastItem[]>([]);

export function getToasts(): ToastItem[] {
  return items;
}

export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
}

export function pushToast(
  message: string,
  tone: ToastTone = 'info',
  durationMs = 3200
): number {
  const id = nextId++;
  // Retain at most the 4 most recent notifications so the toast stack stays bounded
  items = [...items.slice(-3), { id, message, tone }];
  if (durationMs > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}
