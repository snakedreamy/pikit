import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test.describe('P5 Encrypted Peer Drop (/drop) & v0.2.0 Toolbox Upgrades', () => {
  test('pairs two isolated browser contexts via 6-digit code for E2EE text and multi-chunk binary file transfers', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    const externalRequests: string[] = [];
    const pageErrors: string[] = [];

    const senderCtx = await browser.newContext({ baseURL });
    const receiverCtx = await browser.newContext({ baseURL });
    const senderPage = await senderCtx.newPage();
    const receiverPage = await receiverCtx.newPage();

    for (const p of [senderPage, receiverPage]) {
      p.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        if (baseURL && !url.startsWith(baseURL)) {
          externalRequests.push(url);
        }
      });
      p.on('pageerror', (err) => pageErrors.push(err.message));
    }

    // 1. E2EE Text Snippet Transfer across two separate browser contexts
    await Promise.all([
      senderPage.goto('/drop', { waitUntil: 'networkidle' }),
      receiverPage.goto('/drop', { waitUntil: 'networkidle' }),
    ]);

    const secretMessage =
      'WireGuard Peer = gw.example.ts.net:51820\n端到端加密校验通过 · 零服务器落盘';
    await senderPage.locator('#pk-drop-send-text').fill(secretMessage);
    await senderPage.getByRole('button', { name: /Generate 6-Digit Code|生成 6 位配对码/i }).click();

    const codeLocator = senderPage.getByTestId('drop-generated-code');
    await expect(codeLocator).toBeVisible();
    const rawDisplayCode = (await codeLocator.textContent())?.trim() ?? '';
    const cleanSixDigits = rawDisplayCode.replace(/\D+/g, '');
    expect(cleanSixDigits).toMatch(/^\d{6}$/);

    await receiverPage.getByTestId('drop-join-input').fill(cleanSixDigits);
    await receiverPage.getByRole('button', { name: /Pair & Receive|配对接收/i }).click();

    const receivedTextBlock = receiverPage.getByTestId('drop-received-text');
    await expect(receivedTextBlock).toBeVisible({ timeout: 15_000 });
    await expect(receivedTextBlock).toContainText('gw.example.ts.net:51820');
    await expect(receivedTextBlock).toContainText('端到端加密校验通过');

    // Reset both bays and test a 150 KiB binary file (with NUL bytes) over Zero-Knowledge WS Relay fallback
    await senderPage.getByRole('button', { name: /New Transfer|继续发送/i }).click();
    await receiverPage.getByRole('button', { name: /Clear & Reset|清空缓冲并重置/i }).click();

    await senderPage.evaluate(() => {
      (window as unknown as { __pikbayForceDropRelay?: boolean }).__pikbayForceDropRelay = true;
    });
    await receiverPage.evaluate(() => {
      (window as unknown as { __pikbayForceDropRelay?: boolean }).__pikbayForceDropRelay = true;
    });

    const binaryBytes = Buffer.alloc(150 * 1024);
    for (let i = 0; i < binaryBytes.length; i += 1) {
      binaryBytes[i] = i % 251 === 0 ? 0x00 : (i * 73 + 19) & 0xff;
    }

    await senderPage.getByTestId('drop-file-input').setInputFiles({
      name: 'firmware-image.bin',
      mimeType: 'application/octet-stream',
      buffer: binaryBytes,
    });
    await expect(senderPage.getByTestId('drop-attached-file')).toContainText('firmware-image.bin');

    await senderPage.getByRole('button', { name: /Generate 6-Digit Code|生成 6 位配对码/i }).click();
    await expect(codeLocator).toBeVisible();
    const fileCode = ((await codeLocator.textContent()) ?? '').replace(/\D+/g, '');
    expect(fileCode).toMatch(/^\d{6}$/);

    await receiverPage.getByTestId('drop-join-input').fill(fileCode);
    await receiverPage.getByRole('button', { name: /Pair & Receive|配对接收/i }).click();

    const receivedFileCard = receiverPage.getByTestId('drop-received-file');
    await expect(receivedFileCard).toBeVisible({ timeout: 15_000 });
    await expect(receivedFileCard).toContainText('firmware-image.bin');

    const [download] = await Promise.all([
      receiverPage.waitForEvent('download'),
      receiverPage.getByRole('button', { name: /Save File|保存文件/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('firmware-image.bin');
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const downloadedBuf = fs.readFileSync(savedPath!);
    expect(Buffer.compare(downloadedBuf, binaryBytes)).toBe(0);

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);

    await senderCtx.close();
    await receiverCtx.close();
  });

  test('burns 6-digit pairing room immediately upon a single aborted/wrong-MAC join attempt', async ({
    browser,
    baseURL,
  }) => {
    const senderCtx = await browser.newContext({ baseURL });
    const receiverCtx = await browser.newContext({ baseURL });
    const senderPage = await senderCtx.newPage();
    const receiverPage = await receiverCtx.newPage();

    await Promise.all([
      senderPage.goto('/drop', { waitUntil: 'networkidle' }),
      receiverPage.goto('/drop', { waitUntil: 'networkidle' }),
    ]);

    await senderPage.locator('#pk-drop-send-text').fill('one-shot-secret');
    await senderPage.getByRole('button', { name: /Generate 6-Digit Code|生成 6 位配对码/i }).click();

    const codeLocator = senderPage.getByTestId('drop-generated-code');
    await expect(codeLocator).toBeVisible();
    const validCode = ((await codeLocator.textContent()) ?? '').replace(/\D+/g, '');

    // 1. Guessing a non-existent wrong code fails immediately
    const wrongCode = validCode === '999999' ? '000000' : '999999';
    await receiverPage.getByTestId('drop-join-input').fill(wrongCode);
    await receiverPage.getByRole('button', { name: /Pair & Receive|配对接收/i }).click();
    await expect(receiverPage.getByTestId('drop-receive-error')).toBeVisible();

    // 2. Simulate an attacker claiming `validCode` on the WS endpoint with a wrong PIN / bad MAC:
    //    the room must be destroyed immediately so a subsequent attempt with `validCode` is rejected.
    const burnedStatus = await receiverPage.evaluate(async (targetCode) => {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/drop/ws`;
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'join',
              code: targetCode,
              pubKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
              salt: 'DDDDDDDDDDDDDDDDDDDDDD',
            })
          );
        };
        ws.onmessage = (ev) => {
          const parsed = JSON.parse(String(ev.data)) as { type?: string };
          if (parsed.type === 'joined') {
            // Send a forged key_confirm MAC and close -> burns the room
            ws.send(JSON.stringify({ type: 'key_confirm', mac: 'forged_bad_mac_value_123456' }));
            window.setTimeout(() => {
              ws.close();
              resolve();
            }, 50);
          } else if (parsed.type === 'error') {
            ws.close();
            resolve();
          }
        };
      });
      return 'probed';
    }, validCode);
    expect(burnedStatus).toBe('probed');

    // Sender detects the MAC mismatch and terminates the room
    await expect(senderPage.getByTestId('drop-send-error')).toBeVisible({ timeout: 10_000 });

    // Attempting to reuse `validCode` now must fail with invalid_or_expired
    await receiverPage.getByRole('button', { name: /Clear & Reset|清空缓冲并重置/i }).click();
    await receiverPage.getByTestId('drop-join-input').fill(validCode);
    await receiverPage.getByRole('button', { name: /Pair & Receive|配对接收/i }).click();
    await expect(receiverPage.getByTestId('drop-receive-error')).toBeVisible();

    await senderCtx.close();
    await receiverCtx.close();
  });

  test('verifies upgraded text-diff (Split view & binary SHA-256 detection) and offline text-encrypt round-trip', async ({
    page,
  }) => {
    await page.goto('/tools/text-diff', { waitUntil: 'networkidle' });

    // Switch to Split side-by-side view
    await page.getByRole('radio', { name: /Split|并排视图/i }).click();
    await expect(page.getByTestId('diff-split-view')).toBeVisible();

    // Import two identical binary files containing NUL bytes -> verifies SHA-256 match panel
    const binSample = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x11, 0x22, 0x33]);
    await page.getByTestId('diff-left-file').setInputFiles({
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      buffer: binSample,
    });
    await page.getByTestId('diff-right-file').setInputFiles({
      name: 'b.bin',
      mimeType: 'application/octet-stream',
      buffer: binSample,
    });
    const binPanel = page.getByTestId('diff-binary-panel');
    await expect(binPanel).toBeVisible();
    await expect(binPanel).toContainText(/SHA-256 Match|SHA-256 匹配/i);

    // Verify offline AES-256-GCM `text-encrypt` encrypt -> decrypt round-trip
    await page.goto('/tools/text-encrypt', { waitUntil: 'networkidle' });
    await expect(page.locator('.pk-codeblock__pre')).toContainText('PKB1.');
    await page.getByRole('radio', { name: /Decrypt|解密密文/i }).click();
    await expect(page.locator('.pk-codeblock__pre')).toContainText('PresharedKey');
  });
});
