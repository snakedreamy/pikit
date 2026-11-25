// Single source of truth for supported UI locales:
// To add a 3rd..Nth language (e.g. `zh-TW`, `ja`, `de`), append an entry here and drop matching `<code>.json`
// files into each `locales/` directory — components, tools, search indexing, and CI guards require zero code changes.

export interface LocaleDefinition {
  /** Standard BCP 47 language tag matching `locales/<code>.json` filenames */
  readonly code: string;
  /** Native autonym so users can always recognize and switch back to their language */
  readonly label: string;
  /** Lowercase `navigator.languages` prefixes ordered from most specific to broadest */
  readonly matchPrefixes: readonly string[];
}

export const LOCALE_DEFINITIONS = [
  {
    code: 'en',
    label: 'English',
    matchPrefixes: ['en'],
  },
  {
    code: 'zh-CN',
    label: '简体中文',
    matchPrefixes: ['zh-cn', 'zh-hans', 'zh-sg', 'zh'],
  },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALE_DEFINITIONS)[number]['code'];

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_DEFINITIONS.map((d) => d.code);

export const DEFAULT_LOCALE: Locale = 'en';
