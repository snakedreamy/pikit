// Lightweight reactive i18n runtime (BCP 47 + i18next JSON v4 plural/interpolation format)
import { untrack } from 'svelte';
import { readStorage, writeStorage } from '../storage';
import {
  DEFAULT_LOCALE,
  LOCALE_DEFINITIONS,
  SUPPORTED_LOCALES,
  type Locale,
  type LocaleDefinition,
} from './locales';

export { DEFAULT_LOCALE, LOCALE_DEFINITIONS, SUPPORTED_LOCALES };
export type { Locale, LocaleDefinition };

export type MessageTree = {
  [key: string]: string | MessageTree;
};

export type InterpolationParams = Record<string, string | number>;

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator !== 'undefined') {
    const candidates = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const raw of candidates) {
      if (!raw) continue;
      const lower = raw.toLowerCase();
      for (const def of LOCALE_DEFINITIONS) {
        if (
          def.matchPrefixes.some(
            (prefix) => lower === prefix || lower.startsWith(`${prefix}-`)
          )
        ) {
          return def.code;
        }
      }
    }
  }
  return DEFAULT_LOCALE;
}

function createEmptyCatalogMap(): Record<Locale, Record<string, MessageTree>> {
  const map = {} as Record<Locale, Record<string, MessageTree>>;
  for (const loc of SUPPORTED_LOCALES) {
    map[loc] = {};
  }
  return map;
}

function extractLocaleCodeFromPath(filePath: string): Locale | null {
  const fileName = filePath.split('/').pop() ?? '';
  if (!fileName.endsWith('.json')) return null;
  const code = fileName.slice(0, -'.json'.length);
  return isLocale(code) ? code : null;
}

function unwrapModuleTree(mod: MessageTree | { default: MessageTree }): MessageTree {
  if (
    mod &&
    typeof mod === 'object' &&
    'default' in mod &&
    mod.default &&
    typeof mod.default === 'object'
  ) {
    return mod.default as MessageTree;
  }
  return mod as MessageTree;
}

const catalogs: Record<Locale, Record<string, MessageTree>> = createEmptyCatalogMap();
const warnedKeys = new Set<string>();

const initialLocale: Locale = readStorage('locale', isLocale, detectBrowserLocale());

let activeLocale = $state<Locale>(initialLocale);
let registryVersion = $state(0);

// Eagerly register root global message bundles from `src/locales/*.json`
const rootGlobalGlob = import.meta.glob<{ default: MessageTree }>(
  '../../locales/*.json',
  { eager: true }
);
for (const [filePath, mod] of Object.entries(rootGlobalGlob)) {
  const loc = extractLocaleCodeFromPath(filePath);
  if (loc) {
    catalogs[loc].global = unwrapModuleTree(mod);
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', initialLocale);
}

export function registerMessages(
  namespace: string,
  bundles: Partial<Record<Locale, MessageTree>>
): void {
  let changed = false;
  for (const loc of SUPPORTED_LOCALES) {
    const nextTree = bundles[loc];
    if (nextTree && catalogs[loc][namespace] !== nextTree) {
      catalogs[loc][namespace] = nextTree;
      changed = true;
    }
  }
  if (changed) {
    untrack(() => {
      registryVersion += 1;
    });
  }
}

/**
 * Registers all locale JSON modules discovered via `import.meta.glob('./locales/*.json', { eager: true })`.
 */
export function registerLocaleGlob(
  namespace: string,
  globModules: Record<string, MessageTree | { default: MessageTree }>
): void {
  const bundles: Partial<Record<Locale, MessageTree>> = {};
  for (const [filePath, mod] of Object.entries(globModules)) {
    const loc = extractLocaleCodeFromPath(filePath);
    if (loc) {
      bundles[loc] = unwrapModuleTree(mod);
    }
  }
  registerMessages(namespace, bundles);
}

/**
 * Builds a `Record<Locale, string>` across all registered locales for cross-locale search indexing.
 */
export function buildLocalizedRecord(
  builder: (locale: Locale) => string
): Record<Locale, string> {
  const out = {} as Record<Locale, string>;
  for (const loc of SUPPORTED_LOCALES) {
    out[loc] = builder(loc);
  }
  return out;
}

/**
 * Collects comma-separated keyword tokens from every registered locale for a given translation key.
 */
export function collectLocalizedKeywords(key: string, namespace = 'global'): string[] {
  const set = new Set<string>();
  for (const loc of SUPPORTED_LOCALES) {
    const raw = translateWithLocale(loc, key, undefined, namespace);
    if (raw && raw !== key) {
      for (const part of raw.split(/[,，]/)) {
        const trimmed = part.trim();
        if (trimmed) set.add(trimmed);
      }
    }
  }
  return Array.from(set);
}

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(next: Locale): void {
  if (!isLocale(next)) return;
  activeLocale = next;
  writeStorage('locale', next);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', next);
  }
}

function lookupPath(tree: MessageTree | undefined, dotPath: string): string | undefined {
  if (!tree) return undefined;
  const parts = dotPath.split('.');
  let cur: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (!cur || typeof cur === 'string' || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const val = params[key];
    return val === undefined ? `{{${key}}}` : String(val);
  });
}

export function translateWithLocale(
  locale: Locale,
  key: string,
  params?: InterpolationParams,
  namespace = 'global'
): string {
  const tree = catalogs[locale]?.[namespace] ?? catalogs[DEFAULT_LOCALE]?.[namespace];
  let resolved: string | undefined;

  if (params && typeof params.count === 'number') {
    const rule = new Intl.PluralRules(locale).select(params.count);
    resolved =
      lookupPath(tree, `${key}_${rule}`) ??
      lookupPath(tree, `${key}_other`) ??
      lookupPath(tree, key);
  } else {
    resolved = lookupPath(tree, key);
  }

  if (resolved === undefined) {
    if (import.meta.env?.DEV) {
      const warnId = `${locale}:${namespace}:${key}`;
      if (!warnedKeys.has(warnId)) {
        warnedKeys.add(warnId);
        console.warn(`[i18n] Missing translation key "${warnId}"`);
      }
    }
    return key;
  }

  return interpolate(resolved, params);
}

/**
 * Reactive translation helper: call `t('nav.dashboard')` directly inside Svelte templates.
 */
export function t(
  key: string,
  params?: InterpolationParams,
  namespace = 'global'
): string {
  const locale = activeLocale;
  void registryVersion;
  return translateWithLocale(locale, key, params, namespace);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(activeLocale, options).format(value);
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / Math.pow(1024, idx);
  const formatted = new Intl.NumberFormat(activeLocale, {
    minimumFractionDigits: idx === 0 ? 0 : decimals,
    maximumFractionDigits: idx === 0 ? 0 : decimals,
  }).format(scaled);
  return `${formatted} ${units[idx]}`;
}

export function formatDateTime(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return 'Invalid Date';
  return new Intl.DateTimeFormat(
    activeLocale,
    options ?? {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }
  ).format(d);
}
