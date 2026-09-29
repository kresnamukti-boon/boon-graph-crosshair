#!/usr/bin/env node
// Concatenates the ES modules under src/core/ into one IIFE-wrapped script,
// then appends src/console/shell.js verbatim, producing dist/rw_crosshair.js.
// Invoked by build_loader.sh. Copied verbatim from boon-assembly-duplicate's
// own scripts/build-dist.js (same rationale there: src/core/ stays real,
// individually unit-tested ES modules rather than hand-inlined into the
// console shell, and this script turns those modules back into one pasteable
// file) — only OUT_PATH differs.
//
// Deliberately plain node, no npm/package.json/dependencies.
//
// Each source module is wrapped as:
//   const __m_<basename> = (function(){ <body, imports rewritten, exports
//     stripped> ; return {<exported names>}; })();
// A module's own `import { a, b } from "./x.js";` becomes
// `const {a, b} = __m_x;` referencing another block's own const — which
// means every module must be emitted AFTER every module it imports from.
// Rather than hand-maintain that order in a manifest, this discovers the
// real order from each module's own import lines and topologically sorts by
// it — so getting the list right is a correctness property of the modules
// themselves, checked here, not a maintenance burden on whoever adds the
// next one.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE_DIRS = ['src/core'];
const SHELL_PATH = 'src/console/shell.js';
const OUT_PATH = 'dist/rw_crosshair.js';

function listModuleFiles() {
  const files = [];
  for (const dir of MODULE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return files;
}

function modVarFor(basename) {
  return '__m_' + basename.replace(/[^A-Za-z0-9]/g, '_');
}

// Single-line named imports only (`import { a, b } from "./x.js";`) — the
// one form this project's modules are allowed to use (enforced by throwing
// on anything else below), so this regex never needs to handle default/
// namespace/multi-line imports.
const IMPORT_RE = /^import \{([^}]*)\} from ["']([^"']+)["'];?\s*$/;
const EXPORT_NAME_RE = /^export (?:async )?(?:function\*?|const|let|class) +([A-Za-z_$][A-Za-z0-9_$]*)/;

function parseModule(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const lines = src.split('\n');
  const deps = new Set();
  const outLines = [];
  const exportNames = [];
  for (const line of lines) {
    const importMatch = line.match(IMPORT_RE);
    if (importMatch) {
      const names = importMatch[1];
      const target = importMatch[2];
      if (!target.startsWith('.')) {
        throw new Error(`${relPath}: only relative imports are supported: ${line.trim()}`);
      }
      const depBase = path.basename(target, '.js');
      deps.add(depBase);
      outLines.push(`const {${names}} = ${modVarFor(depBase)};`);
      continue;
    }
    if (/^\s*import\b/.test(line)) {
      throw new Error(`${relPath}: unsupported import form (only single-line named imports are allowed): ${line.trim()}`);
    }
    if (/^\s*export\s+default\b/.test(line)) {
      throw new Error(`${relPath}: "export default" is not supported: ${line.trim()}`);
    }
    if (/^\s*export\s*\*/.test(line)) {
      throw new Error(`${relPath}: "export *" is not supported: ${line.trim()}`);
    }
    if (/^\s*export\s*\{/.test(line)) {
      throw new Error(`${relPath}: "export { ... }" re-export lists are not supported — export each declaration directly: ${line.trim()}`);
    }
    const exportMatch = line.match(EXPORT_NAME_RE);
    if (exportMatch) exportNames.push(exportMatch[1]);
    outLines.push(line.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/, ''));
  }
  const base = path.basename(relPath, '.js');
  return { relPath, base, body: outLines.join('\n'), exportNames, deps };
}

function topoSort(modules) {
  const byBase = new Map(modules.map((m) => [m.base, m]));
  const done = new Set();
  const inStack = new Set();
  const ordered = [];
  function visit(base, chain) {
    if (done.has(base)) return;
    if (inStack.has(base)) {
      throw new Error(`circular import between modules: ${chain.concat(base).join(' -> ')}`);
    }
    const mod = byBase.get(base);
    if (!mod) {
      throw new Error(`import of unknown module "${base}" (from: ${chain[chain.length - 1] || '?'})`);
    }
    inStack.add(base);
    for (const dep of mod.deps) visit(dep, chain.concat(base));
    inStack.delete(base);
    done.add(base);
    ordered.push(mod);
  }
  for (const m of modules) visit(m.base, []);
  return ordered;
}

function buildDist() {
  const files = listModuleFiles();
  const modules = files.map(parseModule);
  const seenBase = new Map();
  for (const m of modules) {
    if (seenBase.has(m.base)) {
      throw new Error(`duplicate module basename "${m.base}": ${seenBase.get(m.base)} and ${m.relPath}`);
    }
    seenBase.set(m.base, m.relPath);
  }
  const ordered = topoSort(modules);
  const blocks = ordered.map((m) => {
    const varName = modVarFor(m.base);
    return `// ===== ${m.relPath} =====\nconst ${varName} = (function(){\n${m.body}\nreturn {${m.exportNames.join(', ')}};\n})();`;
  });
  const shell = fs.readFileSync(path.join(ROOT, SHELL_PATH), 'utf8');
  blocks.push(`// ===== ${SHELL_PATH} =====\n${shell}`);
  return { source: blocks.join('\n\n'), moduleCount: ordered.length };
}

if (require.main === module) {
  const { source, moduleCount } = buildDist();
  const outAbs = path.join(ROOT, OUT_PATH);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, source);
  console.log(`built ${OUT_PATH} (${source.length} bytes, ${moduleCount} module${moduleCount === 1 ? '' : 's'} + shell)`);
}

module.exports = { buildDist, listModuleFiles, parseModule, topoSort, MODULE_DIRS, SHELL_PATH, OUT_PATH };
