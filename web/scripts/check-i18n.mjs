import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads supported locales from `src/lib/i18n/locales.ts` (single source of truth)
// and verifies that every `locales/*.json` directory across `src/` has identical key sets,
// non-empty string values, and no unregistered locale files.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');
const localesConfigPath = path.join(srcDir, 'lib/i18n/locales.ts');

function loadRequiredLocales() {
  const source = fs.readFileSync(localesConfigPath, 'utf8');
  const matches = [...source.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
  if (matches.length === 0) {
    console.error('[check-i18n] Failed to parse LOCALE_DEFINITIONS from src/lib/i18n/locales.ts');
    process.exit(1);
  }
  return matches;
}

const REQUIRED_LOCALES = loadRequiredLocales();

function findLocaleDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'locales') {
      result.push(full);
    } else {
      result.push(...findLocaleDirs(full));
    }
  }
  return result;
}

function flattenKeys(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, next, out);
    } else {
      out.set(next, v);
    }
  }
  return out;
}

const localeDirs = findLocaleDirs(srcDir);
if (localeDirs.length === 0) {
  console.error('[check-i18n] No locales directories found');
  process.exit(1);
}

const errors = [];

for (const dir of localeDirs) {
  const relDir = path.relative(srcDir, dir);
  const maps = new Map();

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const code = entry.name.slice(0, -'.json'.length);
      if (!REQUIRED_LOCALES.includes(code)) {
        errors.push(`${relDir}/${entry.name}: locale "${code}" is not registered in src/lib/i18n/locales.ts`);
      }
    }
  }

  for (const locale of REQUIRED_LOCALES) {
    const file = path.join(dir, `${locale}.json`);
    if (!fs.existsSync(file)) {
      errors.push(`${relDir}: missing ${locale}.json`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const flat = flattenKeys(data);
    for (const [k, val] of flat.entries()) {
      if (typeof val !== 'string' || val.trim() === '') {
        errors.push(`${relDir}/${locale}.json: key "${k}" must be a non-empty string`);
        continue;
      }
      const singleBrace = val.match(/(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/);
      if (singleBrace) {
        errors.push(
          `${relDir}/${locale}.json: key "${k}" uses single-brace "${singleBrace[0]}" instead of i18next "{{...}}" interpolation`
        );
      }
    }
    maps.set(locale, flat);
  }

  if (maps.size === REQUIRED_LOCALES.length) {
    const baseLocale = REQUIRED_LOCALES[0];
    const baseMap = maps.get(baseLocale);
    const baseKeys = new Set(baseMap.keys());
    const extractVars = (s) =>
      typeof s === 'string'
        ? [...new Set([...s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]))].sort()
        : [];

    for (const other of REQUIRED_LOCALES.slice(1)) {
      const otherMap = maps.get(other);
      const otherKeys = new Set(otherMap.keys());
      for (const k of baseKeys) {
        if (!otherKeys.has(k)) {
          errors.push(`${relDir}: "${k}" exists in ${baseLocale} but is missing in ${other}`);
          continue;
        }
        const baseVars = extractVars(baseMap.get(k));
        const otherVars = extractVars(otherMap.get(k));
        if (baseVars.join(',') !== otherVars.join(',')) {
          errors.push(
            `${relDir}: placeholder mismatch for "${k}" (${baseLocale}: [${baseVars.join(', ')}] vs ${other}: [${otherVars.join(', ')}])`
          );
        }
      }
      for (const k of otherKeys) {
        if (!baseKeys.has(k)) {
          errors.push(`${relDir}: "${k}" exists in ${other} but is missing in ${baseLocale}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('[check-i18n] Locale alignment check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `[check-i18n] Passed (locales [${REQUIRED_LOCALES.join(', ')}], verified ${localeDirs.length} locale directories)`
);
