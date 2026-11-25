import { describe, expect, it } from 'vitest';
import { computeTextStats, convertAllCases, tokenizeWords } from './logic';

describe('text-case logic', () => {
  it('computes accurate Unicode code point, UTF-8 byte, word/CJK, and line counts', () => {
    const stats = computeTextStats('你好 world 🚀\nsecond line');
    // 2 CJK chars + ' '(1) + 'world'(5) + ' '(1) + emoji(1) + '\n'(1) + 'second line'(11) = 22 code points
    expect(stats.chars).toBe(22);
    expect(stats.charsNoSpaces).toBe(18);
    // 2 CJK * 3B + ' world '(7B) + '🚀'(4B) + '\nsecond line'(12B) = 29B
    expect(stats.utf8Bytes).toBe(29);
    // 2 CJK tokens + 'world' + 'second' + 'line' = 5
    expect(stats.words).toBe(5);
    expect(stats.lines).toBe(2);
  });

  it('splits acronyms, camelCase, snake_case, and numbers cleanly', () => {
    expect(tokenizeWords('XMLHttpParser_v2-beta')).toEqual([
      'xml',
      'http',
      'parser',
      'v2',
      'beta',
    ]);
  });

  it('converts identifiers across all common naming conventions', () => {
    const res = convertAllCases('maxUploadMb_limit');
    expect(res.camelCase).toBe('maxUploadMbLimit');
    expect(res.PascalCase).toBe('MaxUploadMbLimit');
    expect(res.snake_case).toBe('max_upload_mb_limit');
    expect(res['kebab-case']).toBe('max-upload-mb-limit');
    expect(res.CONSTANT_CASE).toBe('MAX_UPLOAD_MB_LIMIT');
    expect(res['dot.case']).toBe('max.upload.mb.limit');
    expect(res['Title Case']).toBe('Max Upload Mb Limit');
  });
});
