import { describe, expect, it } from 'vitest';
import { generateUuidBatch, generateUuidV7 } from './logic';

describe('UUID v4 & RFC 9562 v7 generator', () => {
  it('generates valid RFC 9562 UUIDv7 with monotonic ordering across same-ms bursts and clock rollbacks', () => {
    const fixedTs = 1700000000123;
    const a = generateUuidV7(fixedTs);
    const b = generateUuidV7(fixedTs);
    const c = generateUuidV7(fixedTs - 50);

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('supports v4 batch, uppercase, and hyphenless formatting', () => {
    const list = generateUuidBatch('v4', 5, { uppercase: true, hyphens: false });
    expect(list.length).toBe(5);
    expect(list[0]).toMatch(/^[0-9A-F]{32}$/);
  });

  it('falls back to getRandomValues when crypto.randomUUID is unavailable on plain HTTP', () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      const [id] = generateUuidBatch('v4', 1);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        value: orig,
        configurable: true,
      });
    }
  });
});
