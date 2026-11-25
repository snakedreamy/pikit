import {
  buildLocalizedRecord,
  collectLocalizedKeywords,
  t,
  translateWithLocale,
} from './i18n/index.svelte';
import {
  getRegisteredSearchEntries,
  getRegisteredSearchGroups,
  registerSearchSource,
  type SearchEntry,
  type SearchGroupDescriptor,
} from './search-registry.svelte';

export type { SearchEntry, SearchGroupDescriptor };
export { registerSearchSource };

const NAV_GROUP: SearchGroupDescriptor = {
  id: 'nav',
  order: 10,
  getTitle: () => t('palette.groupNav'),
};

export function getBaseSearchEntries(opts?: { speedtestEnabled?: boolean }): SearchEntry[] {
  const speedEnabled = opts?.speedtestEnabled ?? true;
  const entries: SearchEntry[] = [
    {
      id: 'nav:dashboard',
      group: 'nav',
      href: '/',
      labels: buildLocalizedRecord((loc) => translateWithLocale(loc, 'nav.dashboard')),
      keywords: collectLocalizedKeywords('navKeywords.dashboard'),
    },
    {
      id: 'nav:tools',
      group: 'nav',
      href: '/tools',
      labels: buildLocalizedRecord((loc) => translateWithLocale(loc, 'nav.tools')),
      keywords: collectLocalizedKeywords('navKeywords.tools'),
    },
  ];

  if (speedEnabled) {
    entries.push({
      id: 'nav:speedtest',
      group: 'nav',
      href: '/speedtest',
      labels: buildLocalizedRecord((loc) => translateWithLocale(loc, 'nav.speedtest')),
      keywords: collectLocalizedKeywords('navKeywords.speedtest'),
    });
  }

  return entries;
}

export function getAllSearchGroups(): SearchGroupDescriptor[] {
  const registered = getRegisteredSearchGroups();
  const hasNav = registered.some((g) => g.id === NAV_GROUP.id);
  const combined = hasNav ? registered : [NAV_GROUP, ...registered];
  return combined.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function getAllSearchEntries(opts?: { speedtestEnabled?: boolean }): SearchEntry[] {
  return [...getBaseSearchEntries(opts), ...getRegisteredSearchEntries()];
}

export function filterSearchEntries(entries: SearchEntry[], rawQuery: string): SearchEntry[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return entries;

  const tokens = q.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = [
      ...Object.values(entry.labels),
      ...Object.values(entry.subtitles ?? {}),
      ...(entry.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();

    return tokens.every((tk) => haystack.includes(tk));
  });
}
