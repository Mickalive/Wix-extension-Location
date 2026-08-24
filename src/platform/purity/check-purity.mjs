#!/usr/bin/env node
// Purity gate — Technical Contract section 8.1 / Blueprint section 2.
//
// Fails (exit code 1) when any `@wix/` module specifier is imported from the
// protected pure paths:
//     src/domain/**        (rules-engine lane core)
//     src/billing/pure/**  (billing pure core)
//
// Zero-dependency ESM script. Runnable standalone:
//     node src/platform/purity/check-purity.mjs [rootDir ...]
// (defaults to the two protected roots above; missing directories are skipped
// so the gate stays green before the billing lane creates src/billing/pure).
//
// Limitation note: comment/string stripping below is a pragmatic scanner, not a
// full JS parser. It is intentionally strict: any import-shaped occurrence of
// '@wix/' inside live code fails the gate.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PROTECTED_ROOTS = ['src/domain', 'src/billing/pure'];

const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
]);

const IMPORT_PATTERNS = [
  { kind: 'import/export-from', re: /(?:^|\n)[ \t]*(?:import|export)\b[\s\S]{0,2000}?\bfrom\b[ \t]*['"]@wix\/[^'"\n]*/g },
  { kind: 'side-effect-import', re: /(?:^|\n)[ \t]*import[ \t]*['"]@wix\/[^'"\n]*/g },
  { kind: 'dynamic-import', re: /\bimport[ \t]*\([ \t]*['"]@wix\/[^'"\n]*/g },
  { kind: 'require', re: /\brequire[ \t]*\([ \t]*['"]@wix\/[^'"\n]*/g },
];

/**
 * Removes comments while preserving every newline and all string/template
 * contents (module specifiers live inside strings and must stay scannable).
 * Quote-state aware so `//` inside strings is not treated as a comment.
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let mode = 'code'; // code | line | block | single | double | template
  while (i < n) {
    const c = code[i];
    const next = i + 1 < n ? code[i + 1] : '';
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { mode = 'single'; out += c; i += 1; continue; }
      if (c === '"') { mode = 'double'; out += c; i += 1; continue; }
      if (c === '`') { mode = 'template'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : '';
      i += 1; continue;
    }
    // string modes
    if (c === '\\') { out += code.slice(i, i + 2); i += 2; continue; }
    const close = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (c === close) { mode = 'code'; out += c; i += 1; continue; }
    if (mode !== 'template' && c === '\n') { mode = 'code'; out += '\n'; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}

function listFilesRecursive(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // missing root -> nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...listFilesRecursive(full));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extOf(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

function lineOfIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * @param {string[]} roots directories to scan recursively
 * @returns {{file: string, line: number, kind: string, specifier: string}[]}
 */
export function findWixImports(roots) {
  const violations = [];
  for (const root of roots) {
    for (const file of listFilesRecursive(root)) {
      const raw = readFileSync(file, 'utf8');
      const stripped = stripComments(raw);
      for (const { kind, re } of IMPORT_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(stripped)) !== null) {
          const specifierMatch = /@wix\/[^'"\n]*/.exec(m[0]);
          violations.push({
            file,
            line: lineOfIndex(stripped, m.index),
            kind,
            specifier: specifierMatch ? specifierMatch[0] : '@wix/',
          });
        }
      }
    }
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const roots = args.length > 0 ? args : DEFAULT_PROTECTED_ROOTS;
  const violations = findWixImports(roots);
  if (violations.length > 0) {
    console.error(`PURITY GATE FAILED: ${violations.length} forbidden '@wix/' import(s) under protected paths:`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.kind}] '${v.specifier}'`);
    }
    console.error('Protected paths must stay free of Wix SDK imports (Technical Contract section 8.1).');
    process.exit(1);
  }
  console.log(`Purity gate passed: no '@wix/' imports under ${roots.join(', ')}.`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main();
}
