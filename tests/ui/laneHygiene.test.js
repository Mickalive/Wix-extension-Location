/**
 * Lane hygiene guards.
 *
 * F-N3 regression: no leftover probe/placeholder files may exist in the
 * product tree (the cycle-1 candidate carried src/ui/probe.txt).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(testsDir, '../../src/ui');

test('F-N3: src/ui/probe.txt is absent and never returns', () => {
  assert.equal(existsSync(join(uiRoot, 'probe.txt')), false);
});

test('no placeholder/debug artifacts anywhere under src/ui', () => {
  const offenders = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^(probe|placeholder|todo|scratch|debug)[\w.-]*\.(txt|md|log)$/i.test(entry.name)) {
        offenders.push(full);
      }
    }
  }
  walk(uiRoot);
  assert.deepEqual(offenders, []);
});

test('lane README documents the provisional-validator decision of record', () => {
  const readme = readFileSyncSafe(join(uiRoot, 'README.md'));
  assert.ok(readme, 'src/ui/README.md must exist');
  assert.match(readme, /setValidationSource/);
  assert.match(readme, /F-N1/);
});

function readFileSyncSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
