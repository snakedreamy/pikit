import { readStorage, writeStorage } from './storage';

// Single source of truth for UI theme modes:
// Additional palettes only require an entry here plus a matching `[data-theme="..."]` block in `tokens.css`.
export const THEME_DEFINITIONS = [
  { id: 'system', labelKey: 'topbar.themeSystem' },
  { id: 'dark', labelKey: 'topbar.themeDark' },
  { id: 'light', labelKey: 'topbar.themeLight' },
] as const;

export type ThemeMode = (typeof THEME_DEFINITIONS)[number]['id'];
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

const SUPPORTED_THEME_IDS: readonly string[] = THEME_DEFINITIONS.map((d) => d.id);

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && SUPPORTED_THEME_IDS.includes(v);
}

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

const initialMode: ThemeMode = readStorage('theme', isThemeMode, 'dark');
const initialSystem = getSystemTheme();

let currentMode = $state<ThemeMode>(initialMode);
let systemTheme = $state<'dark' | 'light'>(initialSystem);

function syncDom(mode: ThemeMode, resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-mode', mode);
}

if (typeof window !== 'undefined') {
  syncDom(initialMode, initialMode === 'system' ? initialSystem : initialMode);
  if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener('change', (e) => {
      const next = e.matches ? 'light' : 'dark';
      systemTheme = next;
      if (currentMode === 'system') {
        syncDom('system', next);
      }
    });
  }
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function setThemeMode(mode: ThemeMode): void {
  if (!isThemeMode(mode)) return;
  currentMode = mode;
  writeStorage('theme', mode);
  syncDom(mode, mode === 'system' ? systemTheme : mode);
}
