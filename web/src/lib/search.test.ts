import { describe, expect, it } from 'vitest';
import { filterSearchEntries, getBaseSearchEntries } from './search';

describe('bilingual local search', () => {
  const entries = getBaseSearchEntries();

  it('matches Chinese queries even when searching English entries and vice versa', () => {
    expect(filterSearchEntries(entries, '测速').map((e) => e.id)).toEqual([
      'nav:speedtest',
    ]);
    expect(filterSearchEntries(entries, 'jitter').map((e) => e.id)).toEqual([
      'nav:speedtest',
    ]);
    expect(filterSearchEntries(entries, 'toolbox').map((e) => e.id)).toEqual([
      'nav:tools',
    ]);
  });

  it('returns empty array when no entry matches', () => {
    expect(filterSearchEntries(entries, 'nonexistent-xyz')).toEqual([]);
  });
});
