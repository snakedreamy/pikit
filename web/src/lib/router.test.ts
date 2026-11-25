import { describe, expect, it } from 'vitest';
import { matchRoute } from './router.svelte';

describe('History router path matching & malformed URI defense', () => {
  it('matches standard workspaces and tool IDs', () => {
    expect(matchRoute('/')).toEqual({ name: 'dashboard' });
    expect(matchRoute('/tools/')).toEqual({ name: 'tools' });
    expect(matchRoute('/tools/json-format')).toEqual({ name: 'tool', id: 'json-format' });
    expect(matchRoute('/speedtest?quick=1')).toEqual({ name: 'speedtest' });
  });

  it('gracefully degrades malformed percent-encoded paths to not-found instead of throwing URIError', () => {
    expect(matchRoute('/tools/%E0%A4%A')).toEqual({
      name: 'not-found',
      path: '/tools/%E0%A4%A',
    });
  });
});
