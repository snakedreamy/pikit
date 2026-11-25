import { readStorage, writeStorage } from '../../lib/storage';

function isStringArray(val: unknown): val is string[] {
  return (
    Array.isArray(val) &&
    val.length <= 200 &&
    val.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 64)
  );
}

let favoriteIds = $state<string[]>(readStorage('favorite-tools', isStringArray, []));

export function getFavoriteToolIds(): readonly string[] {
  return favoriteIds;
}

export function isFavoriteTool(id: string): boolean {
  return favoriteIds.includes(id);
}

export function toggleFavoriteTool(id: string): void {
  if (favoriteIds.includes(id)) {
    favoriteIds = favoriteIds.filter((item) => item !== id);
  } else {
    favoriteIds = [id, ...favoriteIds];
  }
  writeStorage('favorite-tools', favoriteIds);
}
