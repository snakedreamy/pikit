import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static network & CSP guard:
// 1. `src/features/tools/**` must never invoke any network API.
// 2. `.svelte` files in `src/**` must never use HTML `style="..."` attributes, static `style:prop="..."` literals, or `{@html}`.
// 3. `src/**` must never hardcode external `http(s)://` URLs (other than the W3C SVG namespace and sample `*.example.*` domains).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');
const toolsDir = path.join(srcDir, 'features/tools');

const NETWORK_PATTERNS = [
  { name: 'fetch()', regex: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', regex: /\bWebSocket\b/ },
  { name: 'EventSource', regex: /\bEventSource\b/ },
  { name: 'sendBeacon', regex: /\bsendBeacon\s*\(/ },
  { name: 'remote dynamic import', regex: /import\s*\(\s*['"`]https?:/ },
];

const SVELTE_CSP_PATTERNS = [
  { name: 'inline style="" attribute', regex: /\sstyle\s*=\s*['"{]/ },
  { name: 'static style:prop="..." literal (may fold into HTML style attr)', regex: /\sstyle:[a-zA-Z0-9_-]+\s*=\s*['"]/ },
  { name: '{@html} directive', regex: /\{@html\b/ },
  { name: 'inline on*= HTML handler', regex: /\son[a-z]+\s*=\s*['"]/ },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|js|mjs|svelte)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const errors = [];

for (const file of walk(toolsDir)) {
  if (file.endsWith('.test.ts')) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of NETWORK_PATTERNS) {
    if (rule.regex.test(content)) {
      errors.push(`[tools offline guard] ${path.relative(srcDir, file)} matched ${rule.name}`);
    }
  }
}

for (const file of walk(srcDir)) {
  if (file.endsWith('.test.ts')) continue;
  const rel = path.relative(srcDir, file);
  const content = fs.readFileSync(file, 'utf8');

  if (file.endsWith('.svelte')) {
    for (const rule of SVELTE_CSP_PATTERNS) {
      if (rule.regex.test(content)) {
        errors.push(`[CSP template guard] ${rel} matched ${rule.name}`);
      }
    }
  }

  // Flag any external CDN/remote URLs outside W3C SVG xmlns and sample placeholder hosts
  const urlMatches = content.match(/https?:\/\/[^\s'"`<>)]+/g) || [];
  for (const u of urlMatches) {
    const allowed =
      u.startsWith('http://www.w3.org/2000/svg') ||
      u.includes('.example.') ||
      u.startsWith('https://example.com') ||
      u.startsWith('http://127.0.0.1');
    if (!allowed) {
      errors.push(`[zero-external-request guard] ${rel} contains external URL: ${u}`);
    }
  }
}

if (errors.length > 0) {
  console.error('[check-no-network] Guard check failed:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log('[check-no-network] Passed (zero network leaks & zero inline CSP attributes)');
