// Guards the one property that makes src/core/ portable into native: every
// fact a module needs from a live page (a DOM node, a global, a stored value)
// must arrive as an argument, never be reached for directly. See PORTING.md.
//
// Two checks: no import from src/console (the injection layer), and no
// reference to document/window/RW/localStorage, or ambient time/randomness,
// in the module's own code. Comments are stripped first and identifiers are
// matched on word boundaries, so prose mentioning these words doesn't trip it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PURE_DIRS = ['src/core'];
const FORBIDDEN_IMPORT_DIRS = ['src/console'];
const FORBIDDEN_IDENTIFIERS = [
  /\bdocument\b/, /\bwindow\b/, /\bRW\./, /\blocalStorage\b/,
  /\bsetTimeout\b/, /\bsetInterval\b/, /\bDate\.now\b/, /\bMath\.random\b/, /\bglobalThis\b/,
];

function listPureFiles() {
  const files = [];
  for (const dir of PURE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return files;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('every src/core module avoids DOM/host globals in its own code', () => {
  const offenders = [];
  for (const rel of listPureFiles()) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const pattern of FORBIDDEN_IDENTIFIERS) {
      if (pattern.test(code)) offenders.push(`${rel} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every src/core module imports nothing from src/console', () => {
  const offenders = [];
  for (const rel of listPureFiles()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const importPaths = [...src.matchAll(/^import\s+.*?from\s+['"](.+?)['"]/gm)].map((m) => m[1]);
    for (const imp of importPaths) {
      const resolved = path.normalize(path.join(path.dirname(rel), imp));
      if (FORBIDDEN_IMPORT_DIRS.some((dir) => resolved.startsWith(dir + path.sep) || resolved === dir)) {
        offenders.push(`${rel} imports ${imp}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('sanity: listPureFiles found src/core/geom.js', () => {
  assert.ok(listPureFiles().includes('src/core/geom.js'));
});
