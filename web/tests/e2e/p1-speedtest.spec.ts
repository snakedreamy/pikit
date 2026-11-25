import { expect, test } from '@playwright/test';

test.describe('P1 Speedtest: Real Parallel Streaming & 429 Rate-Limit Handling', () => {
  test('completes a real speedtest run (/speedtest?quick=1) with non-zero throughput and records browser-local history', async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp.push(e.violatedDirective);
      });
    });

    await page.goto('/speedtest?quick=1', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start Test|开始测速/i }).click();

    // Wait for ping -> download -> upload to finish and populate the first local history row
    const firstHistoryRow = page.locator('.sp-table tbody tr').first();
    await expect(firstHistoryRow).toBeVisible({ timeout: 20_000 });

    const downText = await page.locator('.sp-metric__num--rx').textContent();
    const upText = await page.locator('.sp-metric__num--tx').textContent();
    expect(Number.parseFloat((downText ?? '0').replace(/,/g, ''))).toBeGreaterThan(0);
    expect(Number.parseFloat((upText ?? '0').replace(/,/g, ''))).toBeGreaterThan(0);

    // Confirm both RX and TX oscilloscope polylines rendered
    await expect(page.locator('polyline.sp-scope__rx')).toBeVisible();
    await expect(page.locator('polyline.sp-scope__tx')).toBeVisible();

    const violations = await page.evaluate(
      () => (window as unknown as { __csp: string[] }).__csp
    );
    cspViolations.push(...violations);
    expect(cspViolations).toEqual([]);
  });

  test('displays clear warning banner and stops immediately without retry flood on HTTP 429', async ({
    page,
  }) => {
    let hitCount = 0;
    await page.route('/api/speed/ping*', async (route) => {
      hitCount += 1;
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '5' },
        contentType: 'application/json',
        body: JSON.stringify({ error: 'rate_limited', message: 'rate limited' }),
      });
    });

    await page.goto('/speedtest?quick=1', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start Test|开始测速/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/429/);

    // Abort immediately on HTTP 429 without retry loops
    await page.waitForTimeout(300);
    expect(hitCount).toBe(1);
  });
});
