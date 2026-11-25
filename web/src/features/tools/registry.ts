// Auto-discovering plugin registry for local tools:
// New tools under `catalog/*` and new locale files under `locales/*.json` are wired into i18n and global search automatically.
import {
  buildLocalizedRecord,
  isLocale,
  registerLocaleGlob,
  registerMessages,
  SUPPORTED_LOCALES,
  t,
  translateWithLocale,
  type Locale,
  type MessageTree,
} from '../../lib/i18n/index.svelte';
import { registerSearchSource, type SearchEntry } from '../../lib/search-registry.svelte';
import { getCategoryLabel, TOOL_CATEGORY_IDS } from './categories';
import type { ToolMeta } from './types';

registerLocaleGlob('tools', import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true }));

interface MetaModule {
  toolMeta: ToolMeta;
}

const metaModules = import.meta.glob<MetaModule>('./catalog/*/meta.ts', { eager: true });
const toolLocaleModules = import.meta.glob<{ default: MessageTree }>(
  './catalog/*/locales/*.json',
  { eager: true }
);

const ALL_TOOLS: ToolMeta[] = Object.values(metaModules)
  .map((m) => m.toolMeta)
  .filter(Boolean)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

const bundlesByTool = new Map<string, Partial<Record<Locale, MessageTree>>>();
for (const [filePath, mod] of Object.entries(toolLocaleModules)) {
  // Match `./catalog/<toolId>/locales/<locale>.json`
  const parts = filePath.split('/');
  const catalogIdx = parts.indexOf('catalog');
  const fileName = parts[parts.length - 1] ?? '';
  if (catalogIdx < 0 || !fileName.endsWith('.json')) continue;
  const toolId = parts[catalogIdx + 1];
  const locCode = fileName.slice(0, -'.json'.length);
  if (!toolId || !isLocale(locCode)) continue;

  const map = bundlesByTool.get(toolId) ?? {};
  map[locCode] = mod.default;
  bundlesByTool.set(toolId, map);
}

for (const meta of ALL_TOOLS) {
  const bundles = bundlesByTool.get(meta.id);
  if (bundles) {
    registerMessages(`tool:${meta.id}`, bundles);
  }
}

export { TOOL_CATEGORY_IDS, getCategoryLabel };

export function getAllToolMetas(): readonly ToolMeta[] {
  return ALL_TOOLS;
}

export function getToolMetaById(id: string): ToolMeta | undefined {
  return ALL_TOOLS.find((m) => m.id === id);
}

export function toolName(id: string): string {
  return t('name', undefined, `tool:${id}`);
}

export function toolDescription(id: string): string {
  return t('description', undefined, `tool:${id}`);
}

function buildToolSearchEntries(): SearchEntry[] {
  return ALL_TOOLS.map((meta) => {
    const ns = `tool:${meta.id}`;
    const kwSet = new Set<string>([meta.id, meta.badge]);

    for (const loc of SUPPORTED_LOCALES) {
      kwSet.add(getCategoryLabel(meta.category, loc));
      const rawKw = translateWithLocale(loc, 'keywords', undefined, ns);
      if (rawKw && rawKw !== 'keywords') {
        for (const token of rawKw.split(/[,，]/)) {
          const trimmed = token.trim();
          if (trimmed) kwSet.add(trimmed);
        }
      }
    }

    return {
      id: `tool:${meta.id}`,
      group: 'tool',
      href: `/tools/${meta.id}`,
      labels: buildLocalizedRecord((loc) => translateWithLocale(loc, 'name', undefined, ns)),
      subtitles: buildLocalizedRecord((loc) =>
        translateWithLocale(loc, 'description', undefined, ns)
      ),
      keywords: Array.from(kwSet),
    };
  });
}

registerSearchSource('tools', {
  group: {
    id: 'tool',
    order: 20,
    getTitle: () => t('palette.groupTools'),
  },
  getEntries: buildToolSearchEntries,
});
