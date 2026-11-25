// Schema-versioned `localStorage` wrapper (`pikbay:v1:*`).
// Strictly forbidden for storing any toolbox inputs or outputs; allowed only for theme, locale,
// starred tool IDs, non-sensitive tool preferences, and browser-local speedtest history.

const STORAGE_VERSION = 1;
const PREFIX = `pikbay:v${STORAGE_VERSION}:`;

export type AllowedStorageKey =
  | 'theme'
  | 'locale'
  | 'favorite-tools'
  | 'speedtest-history'
  | `tool-pref:${string}`;

interface Envelope<T> {
  v: number;
  data: T;
}

export function readStorage<T>(
  key: AllowedStorageKey,
  validate: (val: unknown) => val is T,
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback;
  const fullKey = `${PREFIX}${key}`;
  try {
    const raw = window.localStorage.getItem(fullKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Envelope<unknown>>;
    if (parsed.v !== STORAGE_VERSION || !validate(parsed.data)) {
      window.localStorage.removeItem(fullKey);
      return fallback;
    }
    return parsed.data;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: AllowedStorageKey, data: T): void {
  if (typeof window === 'undefined') return;
  const fullKey = `${PREFIX}${key}`;
  try {
    const envelope: Envelope<T> = { v: STORAGE_VERSION, data };
    window.localStorage.setItem(fullKey, JSON.stringify(envelope));
  } catch {
    // Degrade silently in private-browsing or quota-exceeded environments
  }
}
