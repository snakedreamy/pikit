import { describe, expect, it } from 'vitest';
import { diffTexts } from './logic';

describe('Myers text diff (line + inline character diff)', () => {
  it('computes minimal line edits and inline character segments', () => {
    const a = 'listen = "0.0.0.0:8080"\nenabled = true';
    const b = 'listen = "127.0.0.1:8080"\nenabled = true\nper_core = true';
    const res = diffTexts(a, b);
    expect(res.removed).toBe(1);
    expect(res.added).toBe(2);
    expect(res.lines[0].kind).toBe('delete');
    expect(res.lines[1].kind).toBe('insert');
    expect(res.lines[0].inline?.some((s) => s.kind === 'delete')).toBe(true);
    expect(res.lines[1].inline?.some((s) => s.kind === 'insert')).toBe(true);
  });

  it('handles multi-thousand-line inputs swiftly without exhausting memory', () => {
    const bigA = Array.from({ length: 3000 }, (_, i) => `line-a-${i}`).join('\n');
    const bigB = Array.from({ length: 3000 }, (_, i) => `line-b-${i}`).join('\n');
    const t0 = performance.now();
    const res = diffTexts(bigA, bigB);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(res.removed).toBe(3000);
    expect(res.added).toBe(3000);
    expect(res.approximated).toBeUndefined();
  });

  it('accurately isolates head and tail edits on 1250+ line configs without full-delete fallback', () => {
    const base = Array.from({ length: 1250 }, (_, i) => `key_${i} = ${i}`);
    const next = [...base];
    next[0] = 'key_0 = 9999';
    next[1249] = 'key_1249 = 8888';

    const res = diffTexts(base.join('\n'), next.join('\n'));
    expect(res.removed).toBe(2);
    expect(res.added).toBe(2);
    expect(res.approximated).toBeUndefined();
  });
});
