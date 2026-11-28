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

    // Explicit `ms` mode disambiguates early-1970 millisecond values (< 1e11) such as 1970-01-02T00:00:00Z
    const dayTwo = parseFlexibleTimestamp('1970-01-02T00:00:00Z')!;
    expect(dayTwo.epochMs).toBe(86400000);
    const roundTripMs = parseFlexibleTimestamp(String(dayTwo.epochMs), 'ms')!;
    expect(roundTripMs.isoUtc).toBe('1970-01-02T00:00:00.000Z');
  });

  it('returns null on invalid date strings and impossible calendar rollovers', () => {
    expect(parseFlexibleTimestamp('not-a-timestamp')).toBeNull();
    expect(parseFlexibleTimestamp('2026-02-30')).toBeNull();
    expect(parseFlexibleTimestamp('2026-02-29T10:00:00Z')).toBeNull();
    expect(parseFlexibleTimestamp('2026-04-31')).toBeNull();
    expect(parseFlexibleTimestamp('30 Feb 2026')).toBeNull();
    expect(parseFlexibleTimestamp('2024-02-29T00:00:00Z')?.isoUtc).toBe('2024-02-29T00:00:00.000Z');
  });
});
