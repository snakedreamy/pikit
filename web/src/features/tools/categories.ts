// Single source of truth for tool category IDs:
// Localized category labels live under `categories.<id>` in `features/tools/locales/*.json`.
import { t, translateWithLocale, type Locale } from '../../lib/i18n/index.svelte';

export const TOOL_CATEGORY_IDS = [
  'encoding',
  'crypto',
  'tokens',
  'text',
  'formats',
  'network',
  'datetime',
  'web',
  'math',
  'media',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORY_IDS)[number];

export function getCategoryLabel(cat: ToolCategory, locale?: Locale): string {
  const key = `categories.${cat}`;
  return locale ? translateWithLocale(locale, key, undefined, 'tools') : t(key, undefined, 'tools');
}
