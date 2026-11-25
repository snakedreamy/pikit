import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Four-layer unidirectional architecture boundary guard:
// 1. `ui/**` must never import from `features/`, `shell/`, or `dev/`
// 2. `lib/**` must never import from `features/`, `shell/`, or `dev/`
// 3. `features/<domain>/**` must never import across `features/<other>/**` or from `shell/` / `dev/`
// 4. `features/tools/catalog/<toolA>/**` must never import directly from another tool directory
// 5. `features/tools/registry.ts` must never statically import `Tool.svelte` (preserving per-tool lazy chunking)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|js|svelte)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

function extractRelativeTargets(filePath, content) {
  const targets = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(filePath), spec);
    const relToSrc = path.relative(srcDir, resolved).split(path.sep).join('/');
    targets.push({ spec, relToSrc });
  }
  return targets;
}

function getLayerInfo(relFile) {
  const parts = relFile.split('/');
  const top = parts[0];
  if (top === 'ui') return { layer: 'ui' };
  if (top === 'lib') return { layer: 'lib' };
  if (top === 'features') {
    const domain = parts[1] || '';
    const catalogTool =
      domain === 'tools' && parts[2] === 'catalog' ? parts[3] || null : null;
    return { layer: 'features', domain, catalogTool };
  }
  if (top === 'shell') return { layer: 'shell' };
  if (top === 'dev') return { layer: 'dev' };
  return { layer: 'root' };
}

const errors = [];

for (const file of walk(srcDir)) {
  const relFile = path.relative(srcDir, file).split(path.sep).join('/');
  const content = fs.readFileSync(file, 'utf8');
  const from = getLayerInfo(relFile);
  const imports = extractRelativeTargets(file, content);

  for (const imp of imports) {
    const to = getLayerInfo(imp.relToSrc);

    if (from.layer === 'ui' && ['features', 'shell', 'dev'].includes(to.layer)) {
      errors.push(`[ui layer violation] ${relFile} must not import ${imp.spec} (${to.layer})`);
    }

    if (from.layer === 'lib' && ['features', 'shell', 'dev'].includes(to.layer)) {
      errors.push(`[lib layer violation] ${relFile} must not import ${imp.spec} (${to.layer})`);
    }

    if (from.layer === 'features') {
      if (to.layer === 'shell' || to.layer === 'dev') {
        errors.push(`[features upward dependency] ${relFile} must not import ${imp.spec} (${to.layer})`);
      }
      if (to.layer === 'features' && to.domain !== from.domain) {
        errors.push(
          `[cross-feature coupling] ${relFile} (${from.domain}) must not import sibling feature ${imp.spec} (${to.domain})`
        );
      }
      if (
        from.catalogTool &&
        to.catalogTool &&
        to.catalogTool !== from.catalogTool
      ) {
        errors.push(
          `[tool plugin coupling] ${relFile} (${from.catalogTool}) must not import another tool ${imp.spec} (${to.catalogTool})`
        );
      }
    }
  }

  if (relFile === 'features/tools/registry.ts') {
    if (/Tool\.svelte/.test(content)) {
      errors.push(
        `[lazy-chunk guard] ${relFile} must not import Tool.svelte directly; tool UIs must be lazy-loaded via dynamic import() in each meta.ts`
      );
    }
  }
}

if (errors.length > 0) {
  console.error('[check-architecture] Architecture boundary check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('[check-architecture] Passed (4-layer unidirectional boundaries & plugin isolation verified)');
