import { describe, expect, it } from 'vitest';
import { parseFlexibleTimestamp } from './logic';

describe('timestamp converter logic', () => {
  it('auto-detects Unix seconds vs milliseconds and ISO 8601 strings', () => {
    const fromSec = parseFlexibleTimestamp('1700000000')!;
    expect(fromSec.detectedUnit).toBe('s');
    expect(fromSec.epochMs).toBe(1700000000000);
    expect(fromSec.isoUtc).toBe('2023-11-14T22:13:20.000Z');

    const fromMs = parseFlexibleTimestamp('1700000000123')!;
    expect(fromMs.detectedUnit).toBe('ms');
    expect(fromMs.epochSec).toBe(1700000000);
    expect(fromMs.isoUtc).toBe('2023-11-14T22:13:20.123Z');

    const fromIso = parseFlexibleTimestamp('2023-11-14T22:13:20Z')!;
    expect(fromIso.detectedUnit).toBe('date');
    expect(fromIso.epochSec).toBe(1700000000);
  });

  it('returns null on invalid date strings', () => {
    expect(parseFlexibleTimestamp('not-a-timestamp')).toBeNull();
  });
});
