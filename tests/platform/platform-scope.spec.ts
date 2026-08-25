/**
 * Platform lane scope guards (INT-C2-1 acceptance criteria 6–7; extended by
 * INT-C3-1 for src/platform/validation-plugin).
 *
 *  1. PURITY: zero `@wix/` imports anywhere under src/platform/http/**,
 *     src/platform/webhooks/** and src/platform/validation-plugin/** — Wix
 *     access only via injected ports (thin adapters own all SDK usage). Also
 *     pins that the CI purity gate's DEFAULT roots include all three
 *     directories so `npm run check:purity` keeps enforcing this outside
 *     vitest.
 *
 *  2. NO LEAKED BUSINESS LOGIC: a comment-stripped scan of ALL src/platform
 *     TypeScript must find no rules-engine or pricing-policy implementation.
 *     The validation-plugin lane is the ONE sanctioned CONSUMER of the pure
 *     evaluator (Blueprint §4 flow 1), so it is scanned with a refined marker
 *     set that still forbids every form of rule-semantics IMPLEMENTATION
 *     (window algebra, duplicate matching, explanation construction, pricing
 *     vocabulary). Positive-control fixtures prove both scanners actually
 *     detect violations (no rubber stamp).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROTECTED_ROOTS, findWixImports, stripComments } from '../../src/platform/purity/check-purity.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- helpers

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...listTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Business-logic markers that must NEVER appear in live platform code OUTSIDE
 * the validation-plugin consumption seam (comments stripped before scanning).
 * Each entry documents why it indicates a lane-boundary violation:
 *  - rules-engine evaluation/explanation surfaces belong to the pure core;
 *  - pricing/tier/revenue vocabulary belongs to the billing lane;
 *  - quota decision codes belong to rule evaluation, never to transport.
 */
const FORBIDDEN_LOGIC_MARKERS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'rules-engine evaluation entry point', pattern: /\bevaluateRules\b/ },
  { label: 'rule outcome construction', pattern: /\bRuleOutcome\b/ },
  { label: 'customer-facing rule messaging', pattern: /\bcustomerMessage\b/ },
  { label: 'quota decision code', pattern: /\bQUOTA_EXCEEDED\b/ },
  { label: 'pricing vocabulary', pattern: /\b(price|pricing|revenue|usd)\b/i },
  { label: 'billing tier vocabulary', pattern: /\btier\b/i },
];

/**
 * Refined marker set for src/platform/validation-plugin (INT-C3-1): consuming
 * `evaluateRules` and the domain's query-planning helpers is the lane's
 * ASSIGNED job (Blueprint §4 flow 1), but implementing any rule semantics
 * locally remains forbidden. Property READS of domain-produced messages are
 * transport mapping; object-literal CONSTRUCTION is rule logic.
 */
const VALIDATION_PLUGIN_FORBIDDEN_MARKERS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'window algebra implemented locally', pattern: /\b(effectiveWeeklyWindows|resolveDayExceptions|weekdayOfDate|MinuteWindow|isValidWindowStartMinute)\b/ },
  { label: 'duplicate matching implemented locally', pattern: /\b(findDuplicateConflict|intervalsOverlap)\b/ },
  { label: 'ruleset validation implemented locally', pattern: /\bvalidateRuleSet\b/ },
  { label: 'zone math implemented locally', pattern: /\b(instantForLocalWall|localWallOf|nextLocalDate|dateOfInstant)\b/ },
  { label: 'explanation construction implemented locally', pattern: /\bexplanation\s*\(|\b(allowExplanation|failOpenNotice|ENGINE_RULE_IDS|OUTCOME_CODES)\b/ },
  { label: 'customer-facing rule messaging constructed locally', pattern: /\bcustomerMessage\s*:/ },
  { label: 'rule outcome literal constructed locally', pattern: /\bdecision\s*:\s*['"]/ },
  { label: 'pricing vocabulary', pattern: /\b(price|pricing|revenue|usd)\b/i },
  { label: 'billing tier vocabulary', pattern: /\btier\b/i },
];

interface LogicViolation {
  file: string;
  line: number;
  label: string;
}

function findLogicMarkers(roots: string[], markers: ReadonlyArray<{ label: string; pattern: RegExp }>, excludeSubstring?: string): LogicViolation[] {
  const violations: LogicViolation[] = [];
  for (const root of roots) {
    for (const file of listTsFiles(root)) {
      if (excludeSubstring !== undefined && file.includes(excludeSubstring)) continue;
      const stripped = stripComments(readFileSync(file, 'utf8'));
      const lines = stripped.split('\n');
      lines.forEach((line, idx) => {
        for (const { label, pattern } of markers) {
          if (pattern.test(line)) {
            violations.push({ file, line: idx + 1, label });
          }
        }
      });
    }
  }
  return violations;
}

// --------------------------------------------------------------- tests

describe('purity: no @wix/ imports under src/platform/http, webhooks and validation-plugin', () => {
  it('real repository tree has zero violations in all three directories', () => {
    const violations = findWixImports([
      join(repoRoot, 'src', 'platform', 'http'),
      join(repoRoot, 'src', 'platform', 'webhooks'),
      join(repoRoot, 'src', 'platform', 'validation-plugin'),
    ]);
    expect(violations).toEqual([]);
  });

  it('CI purity gate defaults cover all protected platform directories (npm run check:purity)', () => {
    for (const required of [
      'src/domain',
      'src/billing/pure',
      'src/platform/http',
      'src/platform/webhooks',
      'src/platform/validation-plugin',
    ]) {
      expect(DEFAULT_PROTECTED_ROOTS).toContain(required);
    }
  });

  it('the standalone gate command passes on the real repo with default roots', () => {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, 'src', 'platform', 'purity', 'check-purity.mjs')],
      { encoding: 'utf8' },
    );
    expect(stdout).toContain('src/platform/http');
    expect(stdout).toContain('src/platform/webhooks');
    expect(stdout).toContain('src/platform/validation-plugin');
    expect(stdout).toContain("Purity gate passed");
  });
});

describe('zero-egress determinism (credential-free CI)', () => {
  it('imports no network-capable module anywhere under src/ or tests/', () => {
    // Structural guarantee backing the proxy-blocked rerun (`npm run
    // check:offline`): nothing in the product or its tests can open a socket,
    // so the suite cannot depend on network egress regardless of environment.
    const NETWORK_MODULE = /from ['"](node:)?(http|https|net|dns|tls|undici|axios|got)['"]|from ['"]node:fetch['"]/;
    const violations: string[] = [];
    for (const file of [...listTsFiles(join(repoRoot, 'src')), ...listTsFiles(join(repoRoot, 'tests'))]) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      if (NETWORK_MODULE.test(stripped)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('scope: no rules/pricing logic leaked into src/platform', () => {
  it('comment-stripped scan of src/platform (outside the validation-plugin seam) finds zero markers', () => {
    const violations = findLogicMarkers(
      [join(repoRoot, 'src', 'platform')],
      FORBIDDEN_LOGIC_MARKERS,
      join('validation-plugin'),
    );
    expect(violations).toEqual([]);
  });

  it('validation-plugin consumes the evaluator but implements NO rule semantics', () => {
    const violations = findLogicMarkers(
      [join(repoRoot, 'src', 'platform', 'validation-plugin')],
      VALIDATION_PLUGIN_FORBIDDEN_MARKERS,
    );
    expect(violations).toEqual([]);
  });

  it('positive control: the platform scanner flags planted violations (proves it works)', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-scope-fixture-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'leaked.ts'),
      [
        '// comment mentions are stripped: pricing, tier, USD stay invisible',
        'import type { RuleOutcome } from "../shared/types";',
        'export function evaluateRules(): RuleOutcome {',
        '  const price = 9;',
        '  const usd = "USD";',
        '  return { decision: "block", explanations: [{ ruleId: "r", code: "QUOTA_EXCEEDED", customerMessage: "full" }] };',
        '}',
        'export const tier = "gold";',
      ].join('\n'),
    );
    const violations = findLogicMarkers([root], FORBIDDEN_LOGIC_MARKERS);
    const labels = violations.map((v) => v.label);
    expect(labels).toContain('rules-engine evaluation entry point');
    expect(labels).toContain('rule outcome construction');
    expect(labels).toContain('customer-facing rule messaging');
    expect(labels).toContain('quota decision code');
    expect(labels).toContain('pricing vocabulary');
    expect(labels).toContain('billing tier vocabulary');
    // The comment-only mentions were stripped and produced NO violation rows:
    expect(violations.every((v) => v.line !== 1)).toBe(true);
  });

  it('positive control: the validation-plugin scanner flags local rule-semantics implementation', () => {
    const root = mkdtempSync(join(tmpdir(), 'validation-plugin-scope-fixture-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'leaked-rule-logic.ts'),
      [
        '// comment mentions of evaluateRules and pricing stay invisible',
        'import { findDuplicateConflict, explanation } from "../../domain";',
        'export function decide(): unknown {',
        '  const price = 9;',
        '  const conflict = findDuplicateConflict(null as never, [], "UTC");',
        '  const note = explanation("allow", "r", "C", "fine");',
        '  const mapped = { customerMessage: "crafted locally" };',
        '  const verdict = { decision: "block" };',
        '  return { conflict, note, mapped, verdict };',
        '}',
        'export const tier = "gold";',
      ].join('\n'),
    );
    // The ORIGINAL scanner would flag the sanctioned `evaluateRules`-style
    // consumption seam — that is exactly why the refined list exists.
    const originalHits = findLogicMarkers([root], FORBIDDEN_LOGIC_MARKERS).map((v) => v.label);
    expect(originalHits).toContain('customer-facing rule messaging');

    const violations = findLogicMarkers([root], VALIDATION_PLUGIN_FORBIDDEN_MARKERS);
    const labels = violations.map((v) => v.label);
    expect(labels).toContain('duplicate matching implemented locally');
    expect(labels).toContain('explanation construction implemented locally');
    expect(labels).toContain('customer-facing rule messaging constructed locally');
    expect(labels).toContain('rule outcome literal constructed locally');
    expect(labels).toContain('pricing vocabulary');
    expect(labels).toContain('billing tier vocabulary');
  });
});
