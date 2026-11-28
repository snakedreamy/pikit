import { describe, expect, it } from 'vitest';
import { computeNextCronRuns, describeCron, parseCronExpression } from './logic';

describe('cron parser & scheduler', () => {
  it('parses 5-field weekday schedules and computes exact local runs', () => {
    const parsed = parseCronExpression('30 9 * * MON-FRI');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // 2026-11-20 10:00 (Friday local time) -> next run skips to Monday 2026-11-23 09:30
    const base = new Date(2026, 10, 20, 10, 0, 0, 0);
    const runs = computeNextCronRuns(parsed.cron, 3, base);
    expect(runs).toHaveLength(3);
    expect([runs[0].getFullYear(), runs[0].getMonth() + 1, runs[0].getDate(), runs[0].getHours(), runs[0].getMinutes()]).toEqual([
      2026, 11, 23, 9, 30,
    ]);
    expect(runs[1].getDate()).toBe(24);
    expect(runs[2].getDate()).toBe(25);
    expect(describeCron(parsed.cron, 'zh-CN')).toContain('09:30');
    expect(describeCron(parsed.cron, 'en')).toContain('09:30');
  });

  it('supports 6-field second granularity and 7 as Sunday', () => {
    const parsed = parseCronExpression('*/15 * * * * 7');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.cron.dow.values).toEqual([0]);

    const range77 = parseCronExpression('0 0 * * 7-7');
    expect(range77.ok && range77.cron.dow.values).toEqual([0]);

    const stepRange = parseCronExpression('0 0 * * 1-7/2');
    expect(stepRange.ok && stepRange.cron.dow.values).toEqual([0, 1, 3, 5]);

    // 2026-11-22 12:00:02 is a Sunday
    const base = new Date(2026, 10, 22, 12, 0, 2, 0);
    const runs = computeNextCronRuns(parsed.cron, 3, base);
    expect(runs.map((r) => r.getSeconds())).toEqual([15, 30, 45]);
  });

  it('applies standard Vixie OR union when both day-of-month and day-of-week are restricted', () => {
    const parsed = parseCronExpression('0 0 15 * 1');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 2026-11-14 12:00 (Saturday) -> Nov 15 is Sunday (`dom=15`), Nov 16 is Monday (`dow=1`)
    const base = new Date(2026, 10, 14, 12, 0, 0, 0);
    const runs = computeNextCronRuns(parsed.cron, 2, base);
    expect(runs.map((r) => r.getDate())).toEqual([15, 16]);
  });

  it('fast-skips across years for leap-day schedules without stalling and returns all 8 runs', () => {
    const parsed = parseCronExpression('0 0 29 FEB *');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const base = new Date(2026, 0, 1, 0, 0, 0, 0);
    const runs = computeNextCronRuns(parsed.cron, 8, base);
    expect(runs.map((r) => r.getFullYear())).toEqual([
      2028, 2032, 2036, 2040, 2044, 2048, 2052, 2056,
    ]);
  });

  it('rejects invalid expressions', () => {
    expect(parseCronExpression('* * * *').ok).toBe(false);
    expect(parseCronExpression('60 * * * *').ok).toBe(false);
    expect(parseCronExpression('*/0 * * * *').ok).toBe(false);
  });
});
