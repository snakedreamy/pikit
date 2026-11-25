import { describe, expect, it } from 'vitest';
import { decodeUrlText, encodeUrlText } from './logic';

describe('url-codec logic', () => {
  it('encodes and decodes URI components and full URIs accurately', () => {
    const raw = 'https://example.com/search?q=你好 世界&p=1';
    const comp = encodeUrlText(raw, 'component');
    expect(comp.output).toContain('https%3A%2F%2F');
    expect(decodeUrlText(comp.output, 'component').output).toBe(raw);

    const full = encodeUrlText(raw, 'uri');
    expect(full.output.startsWith('https://example.com/search?q=')).toBe(true);
    expect(decodeUrlText(full.output, 'uri').output).toBe(raw);
  });

  it('returns ok:false on malformed percent sequences', () => {
    expect(decodeUrlText('%E0%A4%A', 'component').ok).toBe(false);
  });
});
