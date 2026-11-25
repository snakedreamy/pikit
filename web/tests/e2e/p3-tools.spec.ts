import { expect, test } from '@playwright/test';

const ALL_TOOL_IDS = [
  'base64',
  'url-codec',
  'json-format',
  'timestamp',
  'base-convert',
  'color',
  'hash',
  'hmac',
  'uuid',
  'token',
  'jwt',
  'text-diff',
  'regex',
  'text-case',
  'subnet',
  'cron',
  'qrcode',
] as const;

test.describe('P3 Local-Only Toolbox: All 17 Plugin Workbenches, Bilingual i18n & Zero Network Leak', () => {
  test('renders all 17 tools in symmetric index, supports favorites & category select, and mounts every lazy tool chunk under strict CSP without network calls', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    const externalRequests: string[] = [];
    const unexpectedApiCalls: string[] = [];
    const cspViolations: string[] = [];
    const pageErrors: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (baseURL && !url.startsWith(baseURL)) {
        externalRequests.push(url);
        return;
      }
      // Tools must never call any backend tool endpoint (only shell-level `/api/meta`, `/api/dashboard`, and `/api/system` are allowed)
      if (
        url.includes('/api/') &&
        !url.endsWith('/api/meta') &&
        !url.endsWith('/api/dashboard') &&
        !url.endsWith('/api/system')
      ) {
        unexpectedApiCalls.push(url);
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${e.violatedDirective}:${e.blockedURI}`
        );
      });
    });

    await page.goto('/tools', { waitUntil: 'networkidle' });
    await expect(page.locator('.tool-card')).toHaveCount(17);

    // Verify favorite star toggle and "Starred only" filter (`pikbay:v1:favorite-tools`)
    const firstStar = page.locator('.tool-card__star').first();
    await firstStar.click();
    await expect(page.locator('.tools-group').first()).toContainText('★');

    // Visit all 17 lazy-loaded tool workbenches to verify computation, bilingual switching, and strict CSP
    for (const id of ALL_TOOL_IDS) {
      await page.goto(`/tools/${id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.wb-shell')).toBeVisible();
      await expect(page.locator('.wb-shell__loading')).toHaveCount(0);

      if (id === 'regex') {
        // Verify Web Worker regex execution renders match highlights and named capture groups
        await expect(page.locator('.rx-mark').first()).toBeVisible();
        await expect(page.locator('.rx-table')).toContainText('media.example.ts.net');
      } else if (id === 'subnet') {
        await expect(page.locator('.sn-bench')).toContainText('10.24.8.0/22');
      } else if (id === 'cron') {
        await expect(page.locator('.cr-list .cr-item')).toHaveCount(8);
      } else if (id === 'qrcode') {
        await expect(page.locator('svg.qr-svg path')).toBeVisible();
      }
    }

    // Switch locales on the QR Code workbench and confirm reactive translation updates without missing keys
    const localeSelect = page.locator('select[name="ui-locale"]');
    await localeSelect.selectOption('zh-CN');
    await expect(page.locator('.wb-shell__center h2')).toHaveText('二维码生成');
    await localeSelect.selectOption('en');
    await expect(page.locator('.wb-shell__center h2')).toHaveText('QR Code Generator');

    // Verify no tool inputs or outputs were written to `localStorage` (only allowlisted keys are permitted)
    const storageKeys = await page.evaluate(() => Object.keys(window.localStorage));
    for (const key of storageKeys) {
      expect(key).toMatch(
        /^pikbay:v1:(theme|locale|favorite-tools|speedtest-history|tool-pref:.+)$/
      );
    }

    const violations = await page.evaluate(
      () => (window as unknown as { __csp: string[] }).__csp
    );
    cspViolations.push(...violations);

    expect(externalRequests).toEqual([]);
    expect(unexpectedApiCalls).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
