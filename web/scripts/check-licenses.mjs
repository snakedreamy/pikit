import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifies licenses across the frontend npm dependency tree:
// 1. Runtime dependencies (non-dev) must strictly use permissive licenses.
// 2. Build-only dev dependencies (`dev: true`, never bundled into browser assets, such as lightningcss)
//    additionally allow file-level MPL-2.0, while rejecting GPL / AGPL / LGPL / SSPL third-party packages.
const RUNTIME_ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Zlib',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Unlicense',
]);

const DEV_TOOLCHAIN_EXTRA = new Set(['MPL-2.0']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.resolve(__dirname, '../package-lock.json');

if (!fs.existsSync(lockPath)) {
  console.error('[check-licenses] package-lock.json not found');
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const packages = lock.packages || {};
const violations = [];

function isTokenAllowed(token, isDevOnly) {
  if (RUNTIME_ALLOWED.has(token)) return true;
  if (isDevOnly && DEV_TOOLCHAIN_EXTRA.has(token)) return true;
  return false;
}

function isLicenseAllowed(expr, isDevOnly) {
  if (!expr || typeof expr !== 'string') return false;
  const cleaned = expr.replace(/[()]/g, ' ').trim();
  const parts = cleaned
    .split(/\s+(?:OR|AND|\/)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  if (/\s+OR\s+/i.test(cleaned) && !/\s+AND\s+/i.test(cleaned)) {
    return parts.some((p) => isTokenAllowed(p, isDevOnly));
  }
  return parts.every((p) => isTokenAllowed(p, isDevOnly));
}

for (const [pkgPath, meta] of Object.entries(packages)) {
  if (pkgPath === '') continue;
  let license = meta.license;
  if (!license) {
    const pkgJson = path.resolve(__dirname, '..', pkgPath, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const parsed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      license =
        parsed.license ||
        (Array.isArray(parsed.licenses)
          ? parsed.licenses.map((l) => l.type).join(' OR ')
          : undefined);
    }
  }
  const isDevOnly = Boolean(meta.dev);
  if (!isLicenseAllowed(license, isDevOnly)) {
    violations.push(
      `${pkgPath} (${isDevOnly ? 'dev' : 'runtime'}): ${String(license || 'UNKNOWN')}`
    );
  }
}

if (violations.length > 0) {
  console.error('[check-licenses] Disallowed third-party package licenses detected:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(`[check-licenses] Passed (scanned ${Object.keys(packages).length - 1} packages)`);
