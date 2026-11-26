import { describe, expect, it } from 'vitest';
import {
  buildSplitDisplayRows,
  buildUnifiedDisplayRows,
  containsNulByte,
  diffTexts,
  inspectDiffFileBytes,
} from './logic';

describe('Myers text & file diff (Unified/Split, collapsible context, whitespace & binary SHA-256)', () => {
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
    expect(performance.now() - t0).toBeLessThan(250);
    expect(res.removed).toBe(3000);
    expect(res.added).toBe(3000);
    expect(res.approximated).toBeUndefined();
  });

  it('supports ignoring trailing whitespace and collapsing unchanged context in Unified and Split views', () => {
    const left = [
      ...Array.from({ length: 10 }, (_, i) => `header_${i} = true`),
      'port = 8080   ',
      'workers = 4',
      ...Array.from({ length: 10 }, (_, i) => `footer_${i} = 1`),
    ].join('\n');

    const right = [
      ...Array.from({ length: 10 }, (_, i) => `header_${i} = true`),
      'port = 8080',
      'workers = 8',
      ...Array.from({ length: 10 }, (_, i) => `footer_${i} = 1`),
    ].join('\n');

    const strict = diffTexts(left, right, { ignoreTrailingWhitespace: false });
    expect(strict.removed).toBe(2);
    expect(strict.added).toBe(2);

    const relaxed = diffTexts(left, right, { ignoreTrailingWhitespace: true });
    expect(relaxed.removed).toBe(1);
    expect(relaxed.added).toBe(1);

    const unifiedCollapsed = buildUnifiedDisplayRows(relaxed.lines, true, 2);
    expect(unifiedCollapsed.some((r) => r.type === 'collapsed')).toBe(true);

    const splitRows = buildSplitDisplayRows(relaxed.lines, true, 2);
    expect(splitRows.some((r) => r.type === 'collapsed')).toBe(true);
    const modifiedPair = splitRows.find(
      (r) => r.type === 'pair' && r.left?.kind === 'delete' && r.right?.kind === 'insert'
    );
    expect(modifiedPair).toBeDefined();
  });

  it('detects NUL-containing binary files and computes exact SHA-256 digests instead of garbled text', async () => {
    const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a]);
    expect(containsNulByte(bin)).toBe(true);

    const inspectedA = await inspectDiffFileBytes('logo-a.png', bin.buffer);
    const inspectedB = await inspectDiffFileBytes('logo-b.png', bin.slice().buffer);
    expect(inspectedA.isBinary).toBe(true);
    expect(inspectedA.text).toBe('');
    expect(inspectedA.sha256Hex).toHaveLength(64);
    expect(inspectedA.sha256Hex).toBe(inspectedB.sha256Hex);
  });
});
