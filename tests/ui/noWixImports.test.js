/**
 * Lane purity gate: no Wix runtime module may be referenced anywhere in the
 * dashboard lane except the single services bridge. Includes an anti-vacuity
 * assertion proving the scanner really sees the bridge's reference.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const laneRoots = [
  join(dirname(fileURLToPath(import.meta.url)), '../../src/ui'),
  join(dirname(fileURLToPath(import.meta.url)), '../../src/extensions/dashboard'),
];

function listFilesRecursive(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full));
    else if (statSync(full).isFile()) files.push(full);
  }
  return files;
}

/** Strips comments while preserving string contents (mirrors the platform gate). */
function stripComments(code) {
  let out = '';
  let mode = 'code';
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    const next = code[i + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 1; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c; out += c; continue; }
      out += c;
      continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 1; } if (c === '\n') out += '\n'; continue; }
    if (c === '\\') { out += code.slice(i, i + 2); i += 1; continue; }
    if (c === mode) { mode = 'code'; out += c; continue; }
    out += c;
  }
  return out;
}

const IMPORT_PATTERNS = [
  /(?:^|\n)[ \t]*(?:import|export)\b[\s\S]{0,2000}?\bfrom\b[ \t]*['"]@wix\/[^'"\n]*/g,
  /(?:^|\n)[ \t]*import[ \t]*['"]@wix\/[^'"\n]*/g,
  /\bimport[ \t]*\([ \t]*['"]@wix\/[^'"\n]*/g,
  /\brequire[ \t]*\([ \t]*['"]@wix\/[^'"\n]*/g,
];

test('no Wix imports outside the single services bridge', () => {
  const offenders = [];
  for (const root of laneRoots) {
    for (const file of listFilesRecursive(root)) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(stripped)) {
          offenders.push(file);
          break;
        }
      }
    }
  }
  const normalized = offenders.map((file) => file.replaceAll('\\', '/'));
  assert.deepEqual(
    normalized.filter((file) => !file.endsWith('src/ui/services/bridge.js')),
    [],
    `Wix imports found outside the bridge: ${normalized.join(', ')}`,
  );
  // Exactly one offender total — the bridge itself.
  assert.equal(normalized.length, 1);
  assert.match(normalized[0], /src\/ui\/services\/bridge\.js$/);
});

test('anti-vacuity: the bridge really contains the guarded dynamic reference', () => {
  const bridgePath = join(laneRoots[0], 'services/bridge.js');
  const stripped = stripComments(readFileSync(bridgePath, 'utf8'));
  assert.match(stripped, /import\(\s*['"]@wix\/essentials['"]\s*\)/);
});
