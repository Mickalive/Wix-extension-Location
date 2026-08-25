/**
 * Domain purity suite (Contract §8.1; Blueprint §2 dependency direction).
 *
 * Scans every TypeScript file under src/domain and asserts:
 *  - no Wix SDK import specifiers in live code (the CI gate greps src/domain);
 *  - only RELATIVE module imports (domain -> stdlib + shared, nothing else);
 *  - no host clock reads (Date.now / new Date) — all time is injected;
 *  - no environment or process access.
 *
 * The scanner strips comments and string bodies before applying the
 * forbidden-token checks, so documentation prose can never trip the gate —
 * while import statements are extracted from the RAW text so a real violating
 * specifier always trips it. This mirrors (and cross-checks) the stricter
 * platform gate in src/platform/purity.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOMAIN_ROOT = join(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'domain');

function listDomainFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) out.push(full);
    }
  };
  walk(DOMAIN_ROOT);
  return out;
}

/**
 * Removes comments and string/template BODIES while preserving newlines, so
 * regexes below only ever see live code punctuation.
 */
function stripCommentsAndStringBodies(code: string): string {
  let out = '';
  let mode = 'code'; // code | line | block | single | double | template
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    const next = i + 1 < code.length ? code[i + 1] : '';
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 1; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c === "'" ? 'single' : c === '"' ? 'double' : 'template'; out += c; continue; }
      out += c;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i += 1; }
      continue;
    }
    // string modes: keep quotes, drop bodies (escape-aware)
    if (c === '\\') { i += 1; continue; }
    const close = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (c === close) { mode = 'code'; out += c; }
    if (c === '\n' && mode !== 'template') { mode = 'code'; out += c; }
  }
  return out;
}

const FORBIDDEN_IN_CODE: Array<{ name: string; re: RegExp }> = [
  { name: 'Wix SDK specifier', re: /@wix\// },
  { name: 'host clock read (Date.now)', re: /Date\.now\s*\(/ },
  { name: 'host clock read (new Date)', re: /\bnew\s+Date\b/ },
  { name: 'environment access', re: /\bprocess\b/ },
  { name: 'dynamic require', re: /\brequire\s*\(/ },
];

describe('domain purity', () => {
  const files = listDomainFiles();

  it('discovers the domain sources (scanner sanity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((f) => f.endsWith(join('evaluate.ts')))).toBe(true);
  });

  for (const file of files) {
    it(`is pure: ${file.split('src').pop() ?? file}`, () => {
      const raw = readFileSync(file, 'utf8');
      const codeOnly = stripCommentsAndStringBodies(raw);

      for (const { name, re } of FORBIDDEN_IN_CODE) {
        expect(codeOnly, `${name} found in ${file}`).not.toMatch(re);
      }

      // Import/export specifiers are taken from the RAW text: a real
      // violating specifier must be caught even though string bodies are
      // stripped for the token checks above.
      const specifiers = [
        ...raw.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/g),
        ...raw.matchAll(/\bimport\s+['"]([^'"]+)['"];?/g),
        ...raw.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0); // every domain file imports something
      for (const spec of specifiers) {
        expect(spec, `non-relative import '${spec}' in ${file}`).toMatch(/^\.\.?\//);
      }
    });
  }

  it('keeps ports.ts canonical against accidental semantic edits', () => {
    const ports = files.find((f) => f.endsWith(join('ports.ts')));
    expect(ports).toBeDefined();
    const text = readFileSync(ports as string, 'utf8');
    // The canonical contract exports exactly these port interfaces plus the
    // shared-type re-exports; any semantic edit must go through a Director
    // amendment (docs/NEXT_CYCLE.json canonical_contracts_notice).
    for (const marker of [
      'export interface Clock',
      'export interface RulesConfigStore',
      'export interface ScheduleGateway',
      'export interface AvailabilityGateway',
      'export interface BookingCountGateway',
      'export interface EntitlementGate',
      "from '../shared/types'",
    ]) {
      expect(text).toContain(marker);
    }
  });
});
