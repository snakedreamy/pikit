import { ApiHttpError } from '../../lib/api';
import { buildLocalizedRecord, t } from '../../lib/i18n/index.svelte';
import {
  notifySearchSourceChanged,
  registerSearchSource,
  type SearchEntry,
} from '../../lib/search-registry.svelte';
import type { DashboardData, DashboardGroup, SystemTelemetrySnapshot } from './types';

let cachedGroups: DashboardGroup[] | null = null;
let previewOverrideGroups: DashboardGroup[] | null = null;
let inflightLoad: Promise<DashboardData> | null = null;

function buildBookmarkSearchEntries(sourceGroups: DashboardGroup[]): SearchEntry[] {
  const entries: SearchEntry[] = [];
  sourceGroups.forEach((group, gIdx) => {
    group.items.forEach((item, iIdx) => {
      entries.push({
        id: `bm:${gIdx}:${iIdx}`,
        group: 'bookmark',
        href: item.url,
        external: true,
        labels: buildLocalizedRecord(() => item.name),
        subtitles: buildLocalizedRecord(() => item.description || item.host),
        keywords: [group.name, item.host, item.url],
      });
    });
  });
  return entries;
}

registerSearchSource('dashboard', {
  group: {
    id: 'bookmark',
    order: 30,
    getTitle: () => t('palette.groupBookmarks'),
  },
  getEntries: () => buildBookmarkSearchEntries(previewOverrideGroups ?? cachedGroups ?? []),
});

export function setPreviewBookmarkGroups(groups: DashboardGroup[] | null): void {
  previewOverrideGroups = groups;
  notifySearchSourceChanged();
}

export function clearDashboardBookmarksCache(): void {
  inflightLoad = null;
  if (cachedGroups !== null) {
    cachedGroups = null;
    notifySearchSourceChanged();
  }
}

export async function fetchDashboardData(signal?: AbortSignal): Promise<DashboardData> {
  const res = await fetch('/api/dashboard', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new ApiHttpError(res.status, 'dashboard_error', `HTTP ${res.status}`);
  }
  const data = (await res.json()) as DashboardData;
  cachedGroups = data.groups;
  notifySearchSourceChanged();
  return data;
}

export async function ensureDashboardBookmarksLoaded(
  signal?: AbortSignal
): Promise<DashboardGroup[]> {
  if (cachedGroups !== null) {
    return cachedGroups;
  }
  if (!inflightLoad) {
    inflightLoad = fetchDashboardData(signal).finally(() => {
      inflightLoad = null;
    });
  }
  const data = await inflightLoad;
  return data.groups;
}

export async function fetchSystemTelemetry(
  signal?: AbortSignal
): Promise<SystemTelemetrySnapshot | null> {
  const res = await fetch('/api/system', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ApiHttpError(res.status, 'system_error', `HTTP ${res.status}`);
  }
  return (await res.json()) as SystemTelemetrySnapshot;
}
