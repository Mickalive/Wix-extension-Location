/**
 * Copy-disclosure suite (Contract §12 binds UI wording).
 *
 * Required disclosures (must exist verbatim):
 *   - locations section states Wix has no native per-location hours object;
 *   - caps section carries the C6 concurrent-checkout residual disclosure
 *     including the phrase "can briefly exceed its limit".
 *
 * Banned claims (must not appear anywhere in lane sources):
 *   - reschedule-enforcement guarantees;
 *   - "hard cap" / 100%-duplicate-proof promises;
 *   - assertions of a native per-location hours capability (negations only).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const laneRoots = [
  join(testsDir, '../../src/ui'),
  join(testsDir, '../../src/extensions/dashboard'),
];

function allLaneSources() {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (statSync(full).isFile() && /\.(js|mjs)$/.test(entry.name)) {
        files.push({ path: full, text: readFileSync(full, 'utf8') });
      }
    }
  }
  for (const root of laneRoots) walk(root);
  return files;
}

test('required disclosure: no native per-location hours object (locations section)', () => {
  const pageSource = readFileSync(
    join(testsDir, '../../src/ui/pages/rulesEditorPage.js'),
    'utf8',
  );
  assert.match(pageSource, /Wix Bookings has no native per-location hours object/);
});

test('required disclosure: C6 soft-limit residual risk with exact phrase', () => {
  const pageSource = readFileSync(
    join(testsDir, '../../src/ui/pages/rulesEditorPage.js'),
    'utf8',
  );
  assert.match(pageSource, /can briefly exceed its limit/);
});

test('banned claim: no reschedule-enforcement guarantee anywhere in lane sources', () => {
  for (const { path, text } of allLaneSources()) {
    assert.doesNotMatch(text, /guarantee[sd]?\s+(?:that\s+)?reschedul/i, `${path} promises reschedule enforcement`);
    assert.doesNotMatch(text, /reschedul[^\n]{0,40}\bguarantee/i, `${path} promises reschedule enforcement`);
  }
});

test('banned claim: no hard-cap or 100% duplicate-proof promise', () => {
  for (const { path, text } of allLaneSources()) {
    assert.doesNotMatch(text, /hard\s*cap/i, `${path} claims a hard cap`);
    assert.doesNotMatch(text, /100%\s*(?:duplicate|proof|guarantee)/i, `${path} claims 100% protection`);
  }
});

test('banned claim: never asserts a native per-location hours capability', () => {
  // The only permitted mentions are negations ("no native per-location hours
  // object"). Any non-negated assertion fails.
  for (const { path, text } of allLaneSources()) {
    const matches = [...text.matchAll(/native per-location hours/gi)];
    for (const match of matches) {
      const before = text.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
      assert.ok(
        /\b(no|has no|without|never)\b[^.]*$/.test(before.trim()),
        `${path} appears to assert (not negate) a native per-location hours capability`,
      );
    }
  }
});
