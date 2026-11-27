import { describe, expect, it } from 'vitest';
import {
  computeTextStats,
  convertAllCases,
  detectLineEnding,
  inspectTextFileBytes,
  tokenizeWords,
} from './logic';

describe('text-case logic', () => {
  it('computes accurate grapheme, code point, UTF-16, UTF-8 byte, word/CJK, and line counts', () => {
    const stats = computeTextStats('你好 world 🚀\nsecond line');
    expect(stats.graphemes).toBe(22);
    // 2 CJK chars + ' '(1) + 'world'(5) + ' '(1) + emoji(1) + '\n'(1) + 'second line'(11) = 22 code points
    expect(stats.chars).toBe(22);
    // '🚀' uses a surrogate pair in UTF-16 -> 23 UTF-16 code units
    expect(stats.utf16Units).toBe(23);
    expect(stats.charsNoSpaces).toBe(18);
    expect(stats.whitespace).toBe(4);
    // 2 CJK * 3B + ' world '(7B) + '🚀'(4B) + '\nsecond line'(12B) = 29B
    expect(stats.utf8Bytes).toBe(29);
    // 2 CJK tokens + 'world' + 'second' + 'line' = 5
    expect(stats.cjkChars).toBe(2);
    expect(stats.latinWords).toBe(3);
    expect(stats.words).toBe(5);
    expect(stats.lines).toBe(2);
    expect(stats.nonEmptyLines).toBe(2);
    expect(stats.lineEnding).toBe('LF');
  });

  it('distinguishes ZWJ family emoji graphemes from Unicode code points and UTF-16 units', () => {
    const family = '👨‍👩‍👧‍👦';
    const stats = computeTextStats(family);
    expect(stats.graphemes).toBe(1);
    expect(stats.chars).toBe(7);
    expect(stats.utf16Units).toBe(11);
    expect(stats.utf8Bytes).toBe(25);
  });

  it('separates adjacent Latin words and CJK characters without merging tokens', () => {
    const stats = computeTextStats('pikbay v0.2.0 正式发布！\n\n支持 CRLF 与 LF 检测. Ready?');
    // 'pikbay', 'v0', '2', '0', 'CRLF', 'LF', 'Ready' -> 7 Latin/number words
    // '正','式','发','布','支','持','与','检','测' -> 9 CJK chars
    expect(stats.cjkChars).toBe(9);
    expect(stats.latinWords).toBe(7);
    expect(stats.words).toBe(16);
    expect(stats.digits).toBe(3);
    expect(stats.lines).toBe(3);
    expect(stats.nonEmptyLines).toBe(2);
    expect(stats.paragraphs).toBe(2);
    // Sentences: "pikbay v0.2.0 正式发布！" (v0.2.0 not split), "支持 CRLF 与 LF 检测.", "Ready?" -> 3
    expect(stats.sentences).toBe(3);
    expect(stats.readingSeconds).toBeGreaterThan(0);
    expect(stats.topTokens.length).toBeGreaterThan(0);
  });

  it('detects LF, CRLF, CR, mixed, and none line endings accurately', () => {
    expect(detectLineEnding('single line')).toBe('none');
    expect(detectLineEnding('a\nb\nc')).toBe('LF');
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('CRLF');
    expect(detectLineEnding('a\rb')).toBe('CR');
    expect(detectLineEnding('a\r\nb\nc')).toBe('mixed');
  });

  it('guards local file imports against binary NUL bytes', () => {
    const textBuf = new TextEncoder().encode('hello\nworld').buffer;
    const ok = inspectTextFileBytes('notes.txt', textBuf);
    expect(ok.isBinary).toBe(false);
    expect(ok.text).toBe('hello\nworld');

    const binBuf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]).buffer;
    const bin = inspectTextFileBytes('image.png', binBuf);
    expect(bin.isBinary).toBe(true);
    expect(bin.text).toBe('');
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
