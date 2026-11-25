// Decoupled plugin-style global search registry: feature modules register entries and group descriptors
// without `lib` or `shell` hardcoding domain-specific groups.
import { untrack } from 'svelte';
import type { IconName } from '../icons/names';
import type { Locale } from './i18n/index.svelte';

export interface SearchEntry {
  id: string;
  group: string;
  icon?: IconName;
  href: string;
  external?: boolean;
  /** Localized title and subtitle maps enabling cross-locale bidirectional search */
  labels: Record<Locale, string>;
  subtitles?: Record<Locale, string>;
  keywords?: string[];
}

export interface SearchGroupDescriptor {
  id: string;
  order: number;
  getTitle: () => string;
}

export interface SearchSourceRegistration {
  group: SearchGroupDescriptor;
  getEntries: () => SearchEntry[];
}

const sources = new Map<string, SearchSourceRegistration>();
let sourceVersion = $state(0);

export function registerSearchSource(
  sourceId: string,
  registration: SearchSourceRegistration
): () => void {
  sources.set(sourceId, registration);
  untrack(() => {
    sourceVersion += 1;
  });
  return () => {
    sources.delete(sourceId);
    untrack(() => {
      sourceVersion += 1;
    });
  };
}

export function notifySearchSourceChanged(): void {
  untrack(() => {
    sourceVersion += 1;
  });
}

export function getRegisteredSearchGroups(): SearchGroupDescriptor[] {
  void sourceVersion;
  const byId = new Map<string, SearchGroupDescriptor>();
  for (const reg of sources.values()) {
    const existing = byId.get(reg.group.id);
    if (!existing || reg.group.order < existing.order) {
      byId.set(reg.group.id, reg.group);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id)
  );
}

export function getRegisteredSearchEntries(): SearchEntry[] {
  void sourceVersion;
  const ordered = Array.from(sources.values()).sort(
    (a, b) => a.group.order - b.group.order
  );
  const out: SearchEntry[] = [];
  for (const reg of ordered) {
    out.push(...reg.getEntries());
  }
  return out;
}
