import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  registerMessages,
  setLocale,
  translateWithLocale,
} from './index.svelte';

describe('i18n runtime (BCP 47 + i18next JSON v4)', () => {
  registerMessages('spec', {
    'zh-CN': {
      greeting: '你好，{{name}}',
      result_one: '{{count}} 个匹配项',
      result_other: '{{count}} 个匹配项',
    },
    en: {
      greeting: 'Hello, {{name}}',
      result_one: '{{count}} match',
      result_other: '{{count}} matches',
    },
  });

  it('interpolates {{var}} placeholders accurately', () => {
    expect(translateWithLocale('zh-CN', 'greeting', { name: 'pikbay' }, 'spec')).toBe(
      '你好，pikbay'
    );
    expect(translateWithLocale('en', 'greeting', { name: 'pikbay' }, 'spec')).toBe(
      'Hello, pikbay'
    );
  });

  it('resolves _one / _other plural forms via Intl.PluralRules', () => {
    expect(translateWithLocale('en', 'result', { count: 1 }, 'spec')).toBe('1 match');
    expect(translateWithLocale('en', 'result', { count: 5 }, 'spec')).toBe('5 matches');
    expect(translateWithLocale('zh-CN', 'result', { count: 1 }, 'spec')).toBe('1 个匹配项');
    expect(translateWithLocale('zh-CN', 'result', { count: 5 }, 'spec')).toBe('5 个匹配项');
  });

  it('formats binary byte units cleanly', () => {
    setLocale('en');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MiB');
  });
});
