export type LineEndingKind = 'none' | 'LF' | 'CRLF' | 'CR' | 'mixed';

export interface TokenFrequency {
  token: string;
  count: number;
  percent: number;
}

export interface TextStats {
  graphemes: number;
  chars: number;
  charsNoSpaces: number;
  utf16Units: number;
  utf8Bytes: number;
  words: number;
  latinWords: number;
  cjkChars: number;
  digits: number;
  punctuation: number;
  whitespace: number;
  lines: number;
  nonEmptyLines: number;
  paragraphs: number;
  sentences: number;
  lineEnding: LineEndingKind;
  maxLineLength: number;
  avgLineLength: number;
  readingSeconds: number;
  topTokens: TokenFrequency[];
}

export interface CaseConversions {
  camelCase: string;
  PascalCase: string;
  snake_case: string;
  'kebab-case': string;
  CONSTANT_CASE: string;
  'dot.case': string;
  'Title Case': string;
  lowercase: string;
  UPPERCASE: string;
}

export interface InspectedTextFile {
  fileName: string;
  byteLength: number;
  isBinary: boolean;
  text: string;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD_TOKEN_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const DIGIT_RE = /\p{N}/gu;
const PUNCT_OR_SYMBOL_RE = /[\p{P}\p{S}]/gu;
// Sentence terminators: CJK stops, !/? runs, or ASCII periods not immediately followed by letters/digits (preserves v0.2.0 / 3.14)
const SENTENCE_TERMINATOR_RE = /[。！？…]+|[!?]+|\.(?![\p{L}\p{N}])/gu;

const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _seg of graphemeSegmenter.segment(text)) {
      count += 1;
    }
    return count;
  }
  return Array.from(text).length;
}

export function detectLineEnding(text: string): LineEndingKind {
  if (!text) return 'none';
  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const stripped = crlfCount > 0 ? text.replace(/\r\n/g, '') : text;
  const lfCount = (stripped.match(/\n/g) ?? []).length;
  const crCount = (stripped.match(/\r/g) ?? []).length;

  const kinds = (crlfCount > 0 ? 1 : 0) + (lfCount > 0 ? 1 : 0) + (crCount > 0 ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlfCount > 0) return 'CRLF';
  if (lfCount > 0) return 'LF';
  return 'CR';
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let count = 0;
  let lastIndex = 0;
  for (const match of trimmed.matchAll(SENTENCE_TERMINATOR_RE)) {
    const idx = match.index ?? 0;
    const before = trimmed.slice(lastIndex, idx).trim();
    if (before.length > 0) {
      count += 1;
    }
    lastIndex = idx + match[0].length;
  }

  const tail = trimmed.slice(lastIndex).trim();
  if (tail.length > 0) {
    count += 1;
  }
  return count;
}

export function computeTextStats(text: string, maxTopTokens = 8): TextStats {
  const utf16Units = text.length;
  const graphemes = countGraphemes(text);
  const chars = Array.from(text).length;
  const charsNoSpaces = Array.from(text.replace(/\s+/gu, '')).length;
  const whitespace = chars - charsNoSpaces;
  const utf8Bytes = new TextEncoder().encode(text).byteLength;

  const cjkMatches = text.match(CJK_RE) ?? [];
  const cjkChars = cjkMatches.length;

  const withoutCjk = cjkChars > 0 ? text.replace(CJK_RE, ' ') : text;
  const latinMatches = withoutCjk.match(WORD_TOKEN_RE) ?? [];
  const latinWords = latinMatches.length;
  const words = cjkChars + latinWords;

  const digits = text.match(DIGIT_RE)?.length ?? 0;
  const punctuation = text.match(PUNCT_OR_SYMBOL_RE)?.length ?? 0;

  const lineEnding = detectLineEnding(text);
  const lineList = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
  const lines = lineList.length;

  let nonEmptyLines = 0;
  let maxLineLength = 0;
  let totalLineChars = 0;
  for (const line of lineList) {
    if (line.trim().length > 0) nonEmptyLines += 1;
    const len = Array.from(line).length;
    totalLineChars += len;
    if (len > maxLineLength) maxLineLength = len;
  }
  const avgLineLength = lines > 0 ? Math.round((totalLineChars / lines) * 10) / 10 : 0;

  const trimmed = text.trim();
  const paragraphs =
    trimmed.length === 0
      ? 0
      : trimmed.split(/(?:\r\n|\r|\n)\s*(?:\r\n|\r|\n)+/).filter((p) => p.trim().length > 0)
          .length;
  const sentences = countSentences(text);

  // Mixed-script reading speed: ~300 CJK chars/min + ~200 words/min
  const readingMinutes = cjkChars / 300 + latinWords / 200;
  const readingSeconds = words === 0 ? 0 : Math.max(1, Math.ceil(readingMinutes * 60));

  const freqMap = new Map<string, number>();
  let lexicalTotal = 0;
  for (const w of latinMatches) {
    if (!/\p{L}/u.test(w)) continue;
    const key = w.toLowerCase();
    freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
    lexicalTotal += 1;
  }
  for (const ch of cjkMatches) {
    freqMap.set(ch, (freqMap.get(ch) ?? 0) + 1);
    lexicalTotal += 1;
  }

  const topTokens: TokenFrequency[] =
    lexicalTotal === 0
      ? []
      : Array.from(freqMap.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, maxTopTokens)
          .map(([token, count]) => ({
            token,
            count,
            percent: Math.round((count / lexicalTotal) * 1000) / 10,
          }));

  return {
    graphemes,
    chars,
    charsNoSpaces,
    utf16Units,
    utf8Bytes,
    words,
    latinWords,
    cjkChars,
    digits,
    punctuation,
    whitespace,
    lines,
    nonEmptyLines,
    paragraphs,
    sentences,
    lineEnding,
    maxLineLength,
    avgLineLength,
    readingSeconds,
    topTokens,
  };
}

export function inspectTextFileBytes(fileName: string, buffer: ArrayBuffer): InspectedTextFile {
  const bytes = new Uint8Array(buffer);
  const probeLen = Math.min(bytes.byteLength, 8192);
  for (let i = 0; i < probeLen; i += 1) {
    if (bytes[i] === 0) {
      return {
        fileName,
        byteLength: bytes.byteLength,
        isBinary: true,
        text: '',
      };
    }
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return {
    fileName,
    byteLength: bytes.byteLength,
    isBinary: false,
    text,
  };
}

export function tokenizeWords(input: string): string[] {
  if (!input.trim()) return [];
  const separated = input
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2');

  const matches = separated.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.map((w) => w.toLowerCase()) : [];
}

function capitalize(word: string): string {
  if (!word) return '';
  const chars = Array.from(word);
  return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
}

export function convertAllCases(input: string): CaseConversions {
  const words = tokenizeWords(input);
  return {
    camelCase: words
      .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
      .join(''),
    PascalCase: words.map(capitalize).join(''),
    snake_case: words.join('_'),
    'kebab-case': words.join('-'),
    CONSTANT_CASE: words.map((w) => w.toUpperCase()).join('_'),
    'dot.case': words.join('.'),
    'Title Case': words.map(capitalize).join(' '),
    lowercase: input.toLowerCase(),
    UPPERCASE: input.toUpperCase(),
  };
}
