export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  utf8Bytes: number;
  words: number;
  lines: number;
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

const WORD_OR_CJK_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function computeTextStats(text: string): TextStats {
  const chars = Array.from(text).length;
  const charsNoSpaces = Array.from(text.replace(/\s+/gu, '')).length;
  const utf8Bytes = new TextEncoder().encode(text).byteLength;
  const words = text.match(WORD_OR_CJK_RE)?.length ?? 0;
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  return { chars, charsNoSpaces, utf8Bytes, words, lines };
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
