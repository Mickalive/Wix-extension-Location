/**
 * Billing-lane purity gate (BILL-C2-1-REPAIR; Blueprint §2, Contract §8.1).
 *
 * Acceptance criterion: zero Wix SDK imports under src/billing/pure/** AND the
 * counter core — this suite scans the ENTIRE src/billing tree (the lane must
 * never import the Wix SDK; real access arrives only through ports implemented
 * by the Integration lane). The negative-injection check proves the scanner
 * has teeth.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findWixImports } from '../../src/platform/purity/check-purity.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('billing lane purity (no Wix SDK imports anywhere under src/billing)', () => {
  it('scans the real billing tree clean (pure core, counter, enforcement, upgrade)', () => {
    const violations = findWixImports([join(repoRoot, 'src', 'billing')]);
    expect(violations).toEqual([]);
  });

  it('fails loudly when a fixture injects SDK imports into the pure core or counter', () => {
    const root = mkdtempSync(join(tmpdir(), 'billing-purity-fixture-'));
    tempRoots.push(root);

    const pureDir = join(root, 'pure');
    const counterDir = join(root, 'counter');
    mkdirSync(pureDir, { recursive: true });
    mkdirSync(counterDir, { recursive: true });

    writeFileSync(
      join(pureDir, 'violation-static.ts'),
      [
        "import { plans } from '@wix/pricing-plans';",
        'export const tier = plans;',
      ].join('\n'),
    );
    writeFileSync(
      join(counterDir, 'violation-dynamic.ts'),
      [
        'export async function load(): Promise<unknown> {',
        "  return import('@wix/essentials');",
        '}',
      ].join('\n'),
    );
    writeFileSync(join(counterDir, 'clean.ts'), 'export const ok = true;\n');

    const violations = findWixImports([root]);

    const files = violations.map((v) => v.file);
    expect(files.some((f) => f.includes(join('pure', 'violation-static.ts')))).toBe(true);
    expect(files.some((f) => f.includes(join('counter', 'violation-dynamic.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith('clean.ts'))).toBe(false);

    const staticViolation = violations.find((v) => v.file.endsWith('violation-static.ts'));
    expect(staticViolation?.specifier).toBe('@wix/pricing-plans');
  });
});
