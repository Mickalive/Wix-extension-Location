/**
 * Purity gate tests (INT-C1-1 item a; Contract §8.1; Blueprint §2).
 *
 * Negative proof: injecting '@wix/' imports into src/domain/** or
 * src/billing/pure/** shapes MUST fail the gate — both programmatically and as
 * the real CLI command used by CI. Fixtures are materialized in a temp copy of
 * the protected tree so the repository itself stays pure.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findWixImports } from '../../src/platform/purity/check-purity.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tempRoots: string[] = [];

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'purity-gate-fixture-'));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeFixture(root: string): void {
  const domainDir = join(root, 'src', 'domain');
  const billingPureDir = join(root, 'src', 'billing', 'pure');
  mkdirSync(domainDir, { recursive: true });
  mkdirSync(billingPureDir, { recursive: true });

  writeFileSync(
    join(domainDir, 'clean.ts'),
    'export interface Pure { value: number }\nexport const add = (a: number, b: number): number => a + b;\n',
  );
  // Static + type-only import violations under src/domain/**
  writeFileSync(
    join(domainDir, 'violation-static.ts'),
    [
      "import { dashboard } from '@wix/dashboard';",
      "import type { TokenInfo } from '@wix/essentials';",
      'export const x = 1;',
    ].join('\n'),
  );
  // Dynamic-import violation under src/billing/pure/**
  writeFileSync(
    join(billingPureDir, 'violation-dynamic.ts'),
    [
      'export async function load(): Promise<unknown> {',
      "  return import('@wix/pricing-plans');",
      '}',
    ].join('\n'),
  );
  // require() violation under src/billing/pure/**
  writeFileSync(
    join(billingPureDir, 'violation-require.cjs'),
    "const plans = require('@wix/pricing-plans');\nmodule.exports = { plans };\n",
  );
}

describe('purity gate (no @wix/ imports under protected paths)', () => {
  it('reports every injected @wix/ import with file, line and kind', () => {
    const root = makeTempProject();
    writeFixture(root);

    const violations = findWixImports([join(root, 'src/domain'), join(root, 'src/billing/pure')]);

    const files = violations.map((v) => v.file);
    expect(files.some((f) => f.includes(join('src', 'domain', 'violation-static.ts')))).toBe(true);
    expect(files.some((f) => f.includes(join('src', 'billing', 'pure', 'violation-dynamic.ts')))).toBe(true);
    expect(files.some((f) => f.includes(join('src', 'billing', 'pure', 'violation-require.cjs')))).toBe(true);
    expect(files.some((f) => f.includes('clean.ts'))).toBe(false);

    const staticViolation = violations.find((v) => v.file.endsWith('violation-static.ts'));
    expect(staticViolation).toBeDefined();
    expect(staticViolation?.line).toBe(1); // first line of the file
    expect(staticViolation?.specifier).toBe('@wix/dashboard');

    const kinds = violations.map((v) => v.kind);
    expect(kinds).toContain('import/export-from');
    expect(kinds).toContain('dynamic-import');
    expect(kinds).toContain('require');
  });

  it('fails the actual CI gate command (exit code 1) when a fixture injects @wix/ imports', () => {
    const root = makeTempProject();
    writeFixture(root);

    let exitCode: number | undefined;
    let stderr = '';
    try {
      execFileSync(
        process.execPath,
        [join(repoRoot, 'src', 'platform', 'purity', 'check-purity.mjs'),
         join(root, 'src/domain'), join(root, 'src/billing/pure')],
        { encoding: 'utf8' },
      );
    } catch (error) {
      const err = error as { status?: number; stderr?: string };
      exitCode = err.status;
      stderr = err.stderr ?? '';
    }

    expect(exitCode).toBe(1);
    expect(stderr).toContain('PURITY GATE FAILED');
    expect(stderr).toContain('@wix/dashboard');
  });

  it('passes (exit code 0) on a clean copy of the protected layout', () => {
    const root = makeTempProject();
    const domainDir = join(root, 'src', 'domain');
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(join(domainDir, 'pure.ts'), 'export const ok = true;\n');

    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, 'src', 'platform', 'purity', 'check-purity.mjs'),
       join(root, 'src/domain'), join(root, 'src/billing/pure')],
      { encoding: 'utf8' },
    );
    expect(stdout).toContain("Purity gate passed: no '@wix/' imports");
  });

  it('passes on the real repository tree (guards against regressions in src)', () => {
    const violations = findWixImports([
      join(repoRoot, 'src/domain'),
      join(repoRoot, 'src/billing/pure'),
    ]);
    expect(violations).toEqual([]);
  });
});
