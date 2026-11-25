import { expect, test } from '@playwright/test';

test.describe('P4 Security Hardening & Edge-Case Regression Suite', () => {
  test('enforces Same-Origin Fetch Metadata & Origin guard on /api/* while allowing legitimate requests', async ({
    request,
    baseURL,
  }) => {
    // 1. Cross-site `Sec-Fetch-Site` must return 403 Forbidden
    const crossSite = await request.post('/api/auth/logout', {
      headers: {
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(crossSite.status()).toBe(403);

    // 2. Cross-origin `Origin` on speedtest upload or protected endpoints must return 403 Forbidden
    const badOrigin = await request.post('/api/speed/up', {
      headers: {
        Origin: 'https://attacker.example.com',
      },
      data: 'probe',
    });
    expect(badOrigin.status()).toBe(403);

    // 3. Legitimate same-origin `Origin` and `Sec-Fetch-Site` return 200 OK
    const goodOrigin = await request.get('/api/meta', {
      headers: {
        Origin: baseURL ?? 'http://127.0.0.1:18080',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    expect(goodOrigin.status()).toBe(200);
  });

  test('supports bookmark search from /tools via global palette, handles malformed URI, and isolates ReDoS in Worker', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Entering `/tools` directly (without visiting `/` first) must still index bookmarks in the `/` palette
    await page.goto('/tools', { waitUntil: 'networkidle' });
    await page.keyboard.press('/');
    const searchInput = page.getByPlaceholder(/Type service name|输入服务名/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Jellyfin');
    await expect(page.getByRole('option', { name: /Jellyfin/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // Malformed percent-encoded paths must render a clean 404 state instead of throwing `URIError`
    await page.goto('/tools/%E0%A4%A', { waitUntil: 'networkidle' });
    await expect(page.getByText(/404/)).toBeVisible();

    // Catastrophic regex backtracking (ReDoS) must be terminated within 800ms inside an isolated Web Worker
    await page.goto('/tools/regex', { waitUntil: 'networkidle' });
    await page.locator('#pk-rx-pattern').fill('(a+)+$');
    await page.locator('#pk-rx-sample').fill(`${'a'.repeat(34)}!`);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(/800/);

    // Subsequent benign regex patterns must recover immediately
    await page.locator('#pk-rx-pattern').fill('a+');
    await expect(page.locator('.rx-mark').first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
