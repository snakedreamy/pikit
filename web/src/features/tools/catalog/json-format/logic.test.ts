import { describe, expect, it } from 'vitest';
import { formatJsonText } from './logic';

describe('json-format logic', () => {
  it('prettifies and minifies valid JSON', () => {
    const src = '{"a":1,"b":[true,"ok"]}';
    expect(formatJsonText(src, '2').output).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    "ok"\n  ]\n}');
    expect(formatJsonText('{\n  "x": 2\n}', 'minify').output).toBe('{"x":2}');
  });

  it('pinpoints line and column on invalid JSON', () => {
    const broken = '{\n  "port": 8080,\n  "bad": trux\n}';
    const res = formatJsonText(broken, '2');
    expect(res.ok).toBe(false);
    expect(res.errorLine).toBe(3);
    expect(res.errorColumn).toBeGreaterThanOrEqual(10);
  });

  it('preserves 64-bit integers and exact decimal literals without IEEE-754 rounding', () => {
    const snowflake = '{"id":9007199254740993,"maxU64":18446744073709551615,"price":12.50}';
    const pretty = formatJsonText(snowflake, '2');
    expect(pretty.ok).toBe(true);
    expect(pretty.output).toBe(
      '{\n  "id": 9007199254740993,\n  "maxU64": 18446744073709551615,\n  "price": 12.50\n}'
    );
    expect(formatJsonText(pretty.output, 'minify').output).toBe(snowflake);
  });
});
