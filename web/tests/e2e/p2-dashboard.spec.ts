import { expect, test } from '@playwright/test';

test.describe('P2 Global Telemetry Strip, Auto Multi-Disk Discovery & Bookmarks', () => {
  test('renders live 1s /api/system telemetry strip globally across workspaces with auto-discovered disks', async ({
    page,
    request,
  }) => {
    await page.waitForTimeout(200);
    const sysRes = await request.get('/api/system');
    expect(sysRes.status()).toBe(200);
    const sysJson = await sysRes.json();
    expect(sysJson.refreshSeconds).toBe(1);
    expect(sysJson.memory.totalBytes).toBeGreaterThan(0);
    expect(sysJson.disks.length).toBeGreaterThanOrEqual(1);

    await page.goto('/', { waitUntil: 'networkidle' });

    // Verify the global recessed hardware telemetry strip stays live across workspaces
    const sysStrip = page.locator('.sys-strip');
    await expect(sysStrip).toBeVisible();
    await expect(sysStrip.locator('.sys-bay')).toHaveCount(3);
    await expect(sysStrip).toContainText(/GiB/);

    await page.goto('/speedtest', { waitUntil: 'networkidle' });
    await expect(sysStrip).toBeVisible();
    await expect(sysStrip.locator('.sys-bay')).toHaveCount(3);

    // Verify global command palette covers both configured bookmarks and local tools
    await page.keyboard.press('/');
    const searchInput = page.getByPlaceholder(/Type service name|输入服务名/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Proxmox');
    await expect(page.getByRole('option', { name: /Proxmox VE/i })).toBeVisible();

    await searchInput.fill('Base64');
    await expect(page.getByRole('option', { name: /Base64/i })).toBeVisible();
  });
});
