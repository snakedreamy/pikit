import { expect, test } from '@playwright/test';

const REQUIRED_HEADERS: Record<string, string | RegExp> = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': /camera=\(\), microphone=\(\)/,
};

test.describe('P0 Foundation: Security Headers, Icons Sandbox, Zero External Requests & Strict CSP', () => {
  test('all endpoints return strict security headers, SVG icons get sandbox CSP, and API 404 returns JSON', async ({
    request,
  }) => {
    for (const path of ['/', '/healthz', '/api/meta', '/api/dashboard', '/api/unknown-endpoint']) {
      const res = await request.get(path);
      const headers = res.headers();
      expect(headers['content-security-policy']).toMatch(
        /default-src 'none';.*script-src 'self';.*style-src 'self'/
      );
      for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
        expect(headers[name], `header ${name} on ${path}`).toBeDefined();
        if (typeof expected === 'string') {
          expect(headers[name]).toBe(expected);
        } else {
          expect(headers[name]).toMatch(expected);
        }
      }
    }

    // Custom SVG icons (served from isolated temp directory) must carry the strict `sandbox` CSP header
    const iconRes = await request.get('/icons/probe.svg');
    expect(iconRes.status()).toBe(200);
    expect(iconRes.headers()['content-type']).toContain('image/svg+xml');
    expect(iconRes.headers()['content-security-policy']).toContain('sandbox');

    const missingApi = await request.get('/api/unknown-endpoint');
    expect(missingApi.status()).toBe(404);
    expect(missingApi.headers()['content-type']).toContain('application/json');
  });

  test('traversing symmetric workspaces, custom icons, and local Base64 tool produces zero external requests and zero CSP violations', async ({
    page,
    baseURL,
  }) => {
    const externalRequests: string[] = [];
    const cspViolations: string[] = [];
    const pageErrors: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (baseURL && !url.startsWith(baseURL)) {
        externalRequests.push(url);
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.addInitScript(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
          `${e.violatedDirective}:${e.blockedURI}`
        );
      });
    });

    for (const route of ['/', '/tools', '/tools/base64', '/speedtest', '/drop', '/unknown-route', '/dev/ui']) {
      await page.goto(route, { waitUntil: 'networkidle' });
      const v = await page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations
      );
      cspViolations.push(...v);
    }

    // `/dev/ui` renders a 404 empty state in production builds
    await page.goto('/dev/ui', { waitUntil: 'networkidle' });
    await expect(page.getByText(/404/)).toBeVisible();

    // Verify startpage renders configured bookmarks and automatic monogram fallback (`Proxmox VE` -> `PV`)
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByText('Jellyfin')).toBeVisible();
    await expect(page.getByText('PV', { exact: true })).toBeVisible();

    // Cross-locale command palette search jumps to the speedtest workspace even when queried in Chinese
    await page.keyboard.press('/');
    const searchInput = page.getByPlaceholder(/Type service name/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('测速');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/speedtest$/);

    // Switch UI locale and tri-state theme (`system` / `light` / `dark`) via top-bar selects
    const localeSelect = page.locator('select[name="ui-locale"]');
    await localeSelect.selectOption('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    const themeSelect = page.locator('select[name="theme-mode"]');
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await themeSelect.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await themeSelect.selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');

    const finalViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations
    );
    cspViolations.push(...finalViolations);

    expect(externalRequests).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
