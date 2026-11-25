import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PIKBAY_E2E_PORT || '18080';
const baseURL = `http://127.0.0.1:${port}`;

// Isolate E2E config and custom icon fixtures inside OS temp storage so real `./icons/` files and port 8080 are never touched
const e2eRuntimeDir = path.join(os.tmpdir(), `pikbay-e2e-runtime-${port}`);
const e2eIconsDir = path.join(e2eRuntimeDir, 'icons');
const e2eConfigPath = path.join(e2eRuntimeDir, 'pikbay.e2e.toml');

fs.mkdirSync(e2eIconsDir, { recursive: true });
fs.writeFileSync(
  path.join(e2eIconsDir, 'probe.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>\n',
  'utf8'
);

const exampleToml = fs.readFileSync(
  path.resolve(__dirname, '../config.example.toml'),
  'utf8'
);
const isolatedToml = exampleToml
  .replace(/listen\s*=\s*"[^"]+"/, `listen = "127.0.0.1:${port}"`)
  .replace(/icons_dir\s*=\s*"[^"]+"/, `icons_dir = "${e2eIconsDir.replace(/\\/g, '/')}"`);
fs.writeFileSync(e2eConfigPath, isolatedToml, 'utf8');

const chromeExecutable = fs.existsSync('/usr/bin/google-chrome')
  ? '/usr/bin/google-chrome'
  : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: chromeExecutable,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: `../target/release/pikbay`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      ...process.env,
      PIKBAY_CONFIG: e2eConfigPath,
      PIKBAY_LOG: 'warn',
    },
  },
});
