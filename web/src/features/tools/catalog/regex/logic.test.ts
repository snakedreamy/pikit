import { describe, expect, it } from 'vitest';
import { executeRegexMatches, segmentTextByMatches } from './logic';

describe('regex logic', () => {
  it('extracts named and numbered capture groups across global matches', () => {
    const res = executeRegexMatches(
      '(?<proto>https?)://(?<host>[\\w.-]+)(?::(?<port>\\d+))?',
      'gm',
      'a https://a.example.com:8443\nb http://b.example.com'
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0].groups).toEqual({
      proto: 'https',
      host: 'a.example.com',
      port: '8443',
    });
    expect(res.matches[1].groups).toEqual({
      proto: 'http',
      host: 'b.example.com',
    });
    expect(res.matches[1].captures[2]).toBeNull();
  });

  it('advances safely on zero-length matches respecting the `u` flag and segments without duplicating prefixes', () => {
    const res = executeRegexMatches('a*', 'g', 'aba');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.matches.map((m) => [m.index, m.match])).toEqual([
      [0, 'a'],
      [1, ''],
      [2, 'a'],
      [3, ''],
    ]);

    // Surrogate pair ('🚀' = 2 UTF-16 code units): without `u` steps by 1 UTF-16 unit; with `gu` steps by full code point
    const noU = executeRegexMatches('(?:)', 'g', '🚀');
    expect(noU.ok && noU.matches.map((m) => m.index)).toEqual([0, 1, 2]);
    const withU = executeRegexMatches('(?:)', 'gu', '🚀');
    expect(withU.ok && withU.matches.map((m) => m.index)).toEqual([0, 2]);

    // Zero-width match in the middle of text must not duplicate prefix text in highlighted segments
    const boundary = executeRegexMatches('(?=[A-Z])', 'g', 'fooBar');
    expect(boundary.ok).toBe(true);
    if (!boundary.ok) return;
    const segs = segmentTextByMatches('fooBar', boundary.matches);
    expect(segs.map((s) => s.text)).toEqual(['foo', '▏', 'Bar']);
  });

  it('reports syntax errors cleanly', () => {
    const res = executeRegexMatches('([a-z', 'g', 'hello');
    expect(res.ok).toBe(false);
  });

  it('segments original text around non-overlapping matches without losing characters', () => {
    const sample = 'port=8080, backup=9090!';
    const res = executeRegexMatches('\\d+', 'g', sample);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const segs = segmentTextByMatches(sample, res.matches);
    expect(segs.map((s) => s.text).join('')).toBe(sample);
    expect(segs.filter((s) => s.matched).map((s) => s.text)).toEqual(['8080', '9090']);
  });
});
