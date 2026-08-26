/**
 * Target-matrix property hardening (RULES-C5-1).
 *
 * Source of mandate:
 *  - reports/audits/CYCLE_32881643441_RULES.md §6 observation A: the CANCEL
 *    path resolves via fall-through to the shared allow tail; a future
 *    notice-emitting family that forgets the CANCEL branch must fail LOUDLY,
 *    not silently ("The matrix documentation and pin tests make silent drift
 *    loud" — this suite turns that obligation into executable guards).
 *  - docs/BUILD_BLUEPRINT.md §6: determinism and explanation completeness are
 *    standing properties; they must cover the matrix they guard (swept in
 *    tests/domain/evaluate.spec.ts, RULES-C5-1 items a/b).
 *  - docs/NEXT_CYCLE.json canonical_contracts_notice: ports.ts is FROZEN this
 *    cycle at SHA-256 d46e0743…18802 — pinned below so a freeze breach fails
 *    the suite instead of surfacing at integration time.
 *
 * What this file enforces:
 *  1. MATRIX ↔ CODE CONSISTENCY — every cell of the per-target rule-family
 *     matrix in src/domain/README.md is tied to an OBSERVED evaluator behavior
 *     (a characteristic outcome code appearing / not appearing under each
 *     target). Documentation drift in either direction fails the suite; an
 *     in-suite DELIBERATE DRIFT SIMULATION proves the harness detects flips.
 *  2. CANCEL-TAIL DRIFT GUARD — across a wide CANCEL scenario battery, CANCEL
 *     outcomes may contain ONLY classification-family explanations
 *     (`ruleset`: BOOKING_ALLOWED / RULESET_INVALID / INVALID_SLOT /
 *     EVALUATION_ERROR). The forbidden-family set is DERIVED from the README
 *     matrix's CANCEL column, so changing CANCEL behavior requires a conscious
 *     documentation change too. Anti-vacuity proofs inject every forbidden
 *     family (block AND allow-decision notices) into real CANCEL outcomes and
 *     require the guard to reject each.
 *  3. ACCEPTED-MATRIX META-PINS — the parsed cells must equal the ratified
 *     cycle-4 matrix, so silently editing the doc cannot disarm the guards.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_RULE_IDS, OUTCOME_CODES, evaluateRules } from '../../../src/domain';
import type {
  BookingFacts,
  EvaluationDeps,
  EvaluationTarget,
  RuleOutcome,
  RuleSet,
} from '../../../src/domain';
import {
  ANCHOR_DATES,
  baseRuleSet,
  degradedEntitlement,
  depsWith,
  existingBooking,
  factsAt,
  healthyEntitlement,
  weeklyWindow,
} from '../helpers/builders';
import {
  ALL_TARGETS,
  FALL_BACK_DATE,
  SPRING_FORWARD_DATE,
  factsOnDate,
} from '../helpers/targetScenarios';

const DOMAIN_DIR = join(fileURLToPath(new URL('../../../src/domain', import.meta.url)));
const README_PATH = join(DOMAIN_DIR, 'README.md');
const PORTS_PATH = join(DOMAIN_DIR, 'ports.ts');

// ---------------------------------------------------------------------------
// README matrix parsing — documentation is treated as a test fixture, so any
// structural edit to the table fails loudly here instead of silently
// detaching the guards beneath it.
// ---------------------------------------------------------------------------

type FamilyKey =
  | 'classification'
  | 'entitlement'
  | 'exceptionsWindows'
  | 'caps'
  | 'duplicates';

const FAMILY_KEYS: readonly FamilyKey[] = [
  'classification',
  'entitlement',
  'exceptionsWindows',
  'caps',
  'duplicates',
];

/** Row-label prefixes as written in the README matrix (first cell). */
const FAMILY_LABEL_PREFIXES: Record<FamilyKey, string> = {
  classification: 'fail-closed classification',
  entitlement: 'entitlement coverage',
  exceptionsWindows: 'exceptions + weekly windows',
  caps: 'caps',
  duplicates: 'duplicate protection',
};

/** Engine ruleIds belonging to each matrix family (closed vocabulary). */
const FAMILY_RULE_IDS: Record<FamilyKey, readonly string[]> = {
  classification: [ENGINE_RULE_IDS.ruleSet],
  entitlement: [ENGINE_RULE_IDS.entitlement],
  exceptionsWindows: [ENGINE_RULE_IDS.exceptions, ENGINE_RULE_IDS.weeklyWindows],
  caps: [ENGINE_RULE_IDS.limits],
  duplicates: [ENGINE_RULE_IDS.duplicates],
};

/** Every outcome code each family can emit (blocks AND fail-open notices). */
const FAMILY_OUTCOME_CODES: Record<FamilyKey, readonly string[]> = {
  classification: [
    OUTCOME_CODES.bookingAllowed,
    OUTCOME_CODES.invalidSlot,
    OUTCOME_CODES.rulesetInvalid,
    OUTCOME_CODES.evaluationError,
  ],
  entitlement: [OUTCOME_CODES.locationNotCovered, OUTCOME_CODES.entitlementDegradedFailOpen],
  exceptionsWindows: [OUTCOME_CODES.outsideBookingHours, OUTCOME_CODES.dateClosed],
  caps: [OUTCOME_CODES.quotaExceeded, OUTCOME_CODES.countUnavailableFailOpen],
  duplicates: [OUTCOME_CODES.duplicateBooking, OUTCOME_CODES.identityTimeConflict],
};

interface ParsedMatrix {
  /** cell(family, target) ⇒ the README documents the family as evaluating under target. */
  cell(family: FamilyKey, target: EvaluationTarget): boolean;
  /** Raw table data-row lines (used by the deliberate-drift simulation). */
  rawRows: string[];
}

function extractMatrixRows(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headerIdx = lines.findIndex(
    (l) =>
      /^\|\s*Rule family\s*\|/.test(l) &&
      l.includes('CREATE') &&
      l.includes('CANCEL') &&
      l.includes('RESCHEDULE'),
  );
  if (headerIdx === -1) {
    throw new Error(
      'Target-matrix table header not found in src/domain/README.md — the matrix documentation structure changed; update the table AND this suite consciously.',
    );
  }
  const rows: string[] = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.startsWith('|')) break; // separator row is headerIdx+1; data rows follow
    rows.push(line);
  }
  return rows;
}

function parseCell(raw: string, where: string): boolean {
  const normalized = raw.replaceAll('**', '').trim().toLowerCase();
  if (normalized.startsWith('yes')) return true;
  if (normalized.startsWith('no')) return false;
  throw new Error(
    `Unparseable matrix cell '${raw}' (${where}) — update the README cell format and this parser consciously.`,
  );
}

function parseMatrix(rows: string[]): ParsedMatrix {
  if (rows.length !== FAMILY_KEYS.length) {
    throw new Error(
      `Expected exactly ${FAMILY_KEYS.length} matrix rows, found ${rows.length} — update the README matrix and this suite consciously.`,
    );
  }
  const cells = new Map<string, boolean>();
  const matchedFamilies = new Set<FamilyKey>();
  for (const row of rows) {
    const parts = row.split('|');
    if (parts[0] !== '' || parts[parts.length - 1] !== '') {
      throw new Error(`Malformed matrix row (leading/trailing pipes): ${row}`);
    }
    const inner = parts.slice(1, -1).map((c) => c.trim());
    const label = inner[0] ?? '';
    const family = FAMILY_KEYS.find((k) =>
      label.toLowerCase().startsWith(FAMILY_LABEL_PREFIXES[k]),
    );
    if (family === undefined) {
      throw new Error(
        `Matrix row '${label}' does not map to a known rule family — update the README label or FAMILY_LABEL_PREFIXES consciously.`,
      );
    }
    if (matchedFamilies.has(family)) {
      throw new Error(`Duplicate matrix row for family '${family}'.`);
    }
    matchedFamilies.add(family);
    const targets: EvaluationTarget[] = ['CREATE', 'CANCEL', 'RESCHEDULE'];
    targets.forEach((target, i) => {
      cells.set(`${family}|${target}`, parseCell(inner[i + 1] ?? '', `${family}/${target}`));
    });
  }
  if (matchedFamilies.size !== FAMILY_KEYS.length) {
    throw new Error('Matrix rows do not cover every rule family exactly once.');
  }
  return {
    cell: (family, target) => {
      const v = cells.get(`${family}|${target}`);
      if (v === undefined) throw new Error(`Missing matrix cell ${family}/${target}`);
      return v;
    },
    rawRows: rows,
  };
}

let readmeMatrix: ParsedMatrix;
try {
  readmeMatrix = parseMatrix(extractMatrixRows(readFileSync(README_PATH, 'utf8')));
} catch (err) {
  // Fail at collection time with the parser's loud message, not obscurely later.
  throw new Error(`RULES-C5-1 matrix guard could not parse src/domain/README.md: ${(err as Error).message}`);
}

// ---------------------------------------------------------------------------
// Behavioral probes — one characteristic outcome code per matrix family,
// exercised under scenarios where the family WOULD fire under CREATE.
// ---------------------------------------------------------------------------

interface FamilyProbe {
  id: string;
  family: FamilyKey;
  /** The outcome code whose presence proves the family constrained the outcome. */
  code: string;
  build(): { rules: RuleSet; facts: BookingFacts; deps: EvaluationDeps };
}

const PROBES: readonly FamilyProbe[] = [
  {
    id: 'classification/ruleset-invalid',
    family: 'classification',
    code: OUTCOME_CODES.rulesetInvalid,
    build: () => ({
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] }, // end before start
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    }),
  },
  {
    id: 'entitlement/uncovered-location',
    family: 'entitlement',
    code: OUTCOME_CODES.locationNotCovered,
    build: () => ({
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ entitlement: healthyEntitlement(['loc-other']) }), // loc-1 NOT covered
    }),
  },
  {
    id: 'windows/outside-hours',
    family: 'exceptionsWindows',
    code: OUTCOME_CODES.outsideBookingHours,
    build: () => ({
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 570)] }, // proposal 10:00–11:00 outside
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    }),
  },
  {
    id: 'exceptions/closed-date',
    family: 'exceptionsWindows',
    code: OUTCOME_CODES.dateClosed,
    build: () => ({
      rules: baseRuleSet({
        exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.WED, kind: 'CLOSED' }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    }),
  },
  {
    id: 'caps/quota-exceeded',
    family: 'caps',
    code: OUTCOME_CODES.quotaExceeded,
    build: () => ({
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ countForQuery: () => 1 }), // at cap
    }),
  },
  {
    id: 'duplicates/third-party-overlap',
    family: 'duplicates',
    code: OUTCOME_CODES.duplicateBooking,
    build: () => ({
      rules: baseRuleSet(),
      facts: factsAt('WED', 810, 870), // overlaps the default existing booking
      deps: depsWith({ existingBookings: () => [existingBooking()] }),
    }),
  },
];

/**
 * Runs one probe under one explicit target and reports whether the family's
 * characteristic code appeared. The subject id is supplied uniformly: it is
 * ignored by CREATE/CANCEL (documented) and the duplicates probe overlaps a
 * THIRD-PARTY booking ('bk-ex' ≠ subject), matching the matrix cell
 * "yes, excluding the subject booking".
 */
function probeObservation(probe: FamilyProbe, target: EvaluationTarget): boolean {
  const { rules, facts, deps } = probe.build();
  const outcome = evaluateRules(facts, rules, {
    ...deps,
    targetContext: { target, subjectBookingId: 'bk-subject-probe' },
  });
  return outcome.explanations.some((e) => e.code === probe.code);
}

/** Matrix-vs-code mismatches for a given (possibly drifted) parsed matrix. */
function consistencyViolations(matrix: ParsedMatrix): string[] {
  const violations: string[] = [];
  for (const probe of PROBES) {
    for (const target of ALL_TARGETS) {
      if (matrix.cell(probe.family, target) !== probeObservation(probe, target)) {
        violations.push(`${probe.family}/${target}`);
      }
    }
  }
  return violations;
}

/** Returns the matrix rows with one cell's yes/no flipped (drift fixture). */
function withFlippedCell(rows: string[], rowSubstring: string, target: EvaluationTarget): string[] {
  const columnIdx = target === 'CREATE' ? 2 : target === 'CANCEL' ? 3 : 4;
  const lines = [...rows];
  const rowIdx = lines.findIndex((l) => l.includes(rowSubstring));
  const row = lines[rowIdx];
  if (row === undefined) {
    throw new Error(`Drift fixture: no matrix row contains '${rowSubstring}'.`);
  }
  const parts = row.split('|');
  const cell = parts[columnIdx];
  if (cell === undefined) {
    throw new Error(`Drift fixture: column ${columnIdx} missing in row '${row}'.`);
  }
  const flipped = /(^|\W)no(\W|$)/i.test(cell.replaceAll('**', ''))
    ? cell.replace('no', 'yes')
    : cell.replace('yes', '**no**');
  parts[columnIdx] = flipped;
  lines[rowIdx] = parts.join('|');
  return lines;
}

// ---------------------------------------------------------------------------
// CANCEL-tail drift guard (audit observation A)
// ---------------------------------------------------------------------------

const CLASSIFICATION_RULE_ID = ENGINE_RULE_IDS.ruleSet;
const CLASSIFICATION_CODES: readonly string[] = [
  OUTCOME_CODES.bookingAllowed,
  OUTCOME_CODES.invalidSlot,
  OUTCOME_CODES.rulesetInvalid,
  OUTCOME_CODES.evaluationError,
];

/**
 * The guard: CANCEL outcomes may carry ONLY classification-family
 * explanations. Any other family (or unknown code) is a violation — including
 * ALLOW-decision fail-open notices, which is precisely the silent-drift mode
 * observation A warns about (a notice-emitting family forgetting the CANCEL
 * branch leaves the DECISION untouched while still leaking the family).
 */
function cancelTailViolations(outcome: RuleOutcome): string[] {
  const violations: string[] = [];
  for (const e of outcome.explanations) {
    if (e.ruleId !== CLASSIFICATION_RULE_ID) {
      violations.push(`non-classification ruleId '${e.ruleId}' (${e.code})`);
    } else if (!CLASSIFICATION_CODES.includes(e.code)) {
      violations.push(`unexpected classification code '${e.code}'`);
    }
  }
  return violations;
}

/** Forbidden (family → ruleId/code) injections DERIVED from the README CANCEL column. */
function forbiddenCancelInjections(matrix: ParsedMatrix): Array<{ ruleId: string; code: string }> {
  const injections: Array<{ ruleId: string; code: string }> = [];
  for (const family of FAMILY_KEYS) {
    if (matrix.cell(family, 'CANCEL')) continue; // documented to evaluate → not forbidden
    for (const ruleId of FAMILY_RULE_IDS[family]) {
      for (const code of FAMILY_OUTCOME_CODES[family]) {
        injections.push({ ruleId, code });
      }
    }
  }
  return injections;
}

// ---------------------------------------------------------------------------
// 1. Matrix ↔ code consistency (+ deliberate doc-drift simulation)
// ---------------------------------------------------------------------------

describe('README matrix ↔ evaluator behavior consistency (RULES-C5-1 d)', () => {
  it('discovers all six behavioral probes (probe corpus cannot silently shrink)', () => {
    expect(PROBES).toHaveLength(6);
    expect(new Set(PROBES.map((p) => p.family)).size).toBe(5); // every matrix family probed; exceptionsWindows twice
  });

  it('every README matrix cell matches the observed per-target behavior', () => {
    for (const probe of PROBES) {
      for (const target of ALL_TARGETS) {
        const documented = readmeMatrix.cell(probe.family, target);
        const observed = probeObservation(probe, target);
        expect(
          observed,
          `${probe.id}: ${probe.code} under ${target} — README documents ${
            documented ? 'evaluates' : 'skipped'
          }, code observed ${observed ? 'fired' : 'did not fire'}`,
        ).toBe(documented);
      }
    }
  });

  it('pins the ACCEPTED cycle-4 matrix cells (silent doc edits cannot disarm the guards)', () => {
    const accepted: Record<FamilyKey, Record<EvaluationTarget, boolean>> = {
      classification: { CREATE: true, CANCEL: true, RESCHEDULE: true },
      entitlement: { CREATE: true, CANCEL: false, RESCHEDULE: true },
      exceptionsWindows: { CREATE: true, CANCEL: false, RESCHEDULE: true },
      caps: { CREATE: true, CANCEL: false, RESCHEDULE: true },
      duplicates: { CREATE: true, CANCEL: false, RESCHEDULE: true },
    };
    for (const family of FAMILY_KEYS) {
      for (const target of ALL_TARGETS) {
        expect(
          readmeMatrix.cell(family, target),
          `${family}/${target} drifted from the accepted matrix`,
        ).toBe(accepted[family][target]);
      }
    }
  });

  it('DELIBERATE DOC-DRIFT SIMULATION: flipping a README cell makes the consistency harness fail loudly', () => {
    // Sanity: the REAL documentation agrees with the REAL code today.
    expect(consistencyViolations(readmeMatrix)).toEqual([]);

    // Drift direction 1 — doc claims CANCEL evaluates caps while the code
    // (correctly) skips them: the harness must flag exactly caps/CANCEL.
    const driftedToYes = parseMatrix(
      withFlippedCell(readmeMatrix.rawRows, 'Caps (day', 'CANCEL'),
    );
    expect(consistencyViolations(driftedToYes)).toEqual(['caps/CANCEL']);

    // Drift direction 2 — doc claims CREATE skips duplicates while the code
    // (correctly) evaluates them: the harness must flag exactly
    // duplicates/CREATE.
    const driftedToNo = parseMatrix(
      withFlippedCell(readmeMatrix.rawRows, 'Duplicate protection', 'CREATE'),
    );
    expect(consistencyViolations(driftedToNo)).toEqual(['duplicates/CREATE']);
  });
});

// ---------------------------------------------------------------------------
// 2. CANCEL-tail drift guard over the real evaluator
// ---------------------------------------------------------------------------

describe('CANCEL-tail drift guard — CANCEL outcomes carry ONLY classification explanations (RULES-C5-1 c)', () => {
  interface CancelScenario {
    name: string;
    rules: RuleSet;
    facts: BookingFacts;
    deps: EvaluationDeps;
  }

  const scenarios: CancelScenario[] = [
    { name: 'clean allow', rules: baseRuleSet(), facts: factsAt('WED', 600, 660), deps: depsWith() },
    {
      name: 'outside weekly window (skipped)',
      rules: baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 570)] } }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    },
    {
      name: 'split-window gap (skipped)',
      rules: baseRuleSet({
        serviceWindows: {
          'svc-1': [weeklyWindow('WED', 540, 720), weeklyWindow('WED', 840, 1020)],
        },
      }),
      facts: factsAt('WED', 720, 780),
      deps: depsWith(),
    },
    {
      name: 'CLOSED exception date (skipped)',
      rules: baseRuleSet({
        exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.WED, kind: 'CLOSED' }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    },
    {
      name: 'at-cap day (skipped — cancel frees capacity)',
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['CONFIRMED'] }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ countForQuery: () => 1 }),
    },
    {
      name: 'count-unavailable (family skipped, no notice may leak)',
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ countForQuery: () => null }),
    },
    {
      name: 'throwing counter (never consulted)',
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({
        countForQuery: () => {
          throw new Error('counter exploded');
        },
      }),
    },
    {
      name: 'duplicate overlap (skipped)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 810, 870),
      deps: depsWith({ existingBookings: () => [existingBooking()] }),
    },
    {
      name: 'identity cross-service conflict (skipped)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 810, 870, { identityKey: 'person-1' }),
      deps: depsWith({
        existingBookings: () => [
          existingBooking({ serviceId: 'svc-2', identityKey: 'person-1' }),
        ],
      }),
    },
    {
      name: 'throwing snapshot store (never consulted)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({
        existingBookings: () => {
          throw new Error('snapshot store exploded');
        },
      }),
    },
    {
      name: 'uncovered location (entitlement skipped)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ entitlement: healthyEntitlement(['loc-other']) }),
    },
    {
      name: 'degraded billing signals (no entitlement notice may leak)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ entitlement: degradedEntitlement() }),
    },
    {
      name: 'classification: invalid ruleset still blocks',
      rules: baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] } }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    },
    {
      name: 'classification: inverted slot still blocks',
      rules: baseRuleSet(),
      facts: factsAt('WED', 660, 600),
      deps: depsWith(),
    },
    {
      name: 'classification: missing slots still block',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660, { slotStart: undefined }),
      deps: depsWith(),
    },
    {
      name: 'classification: >24h slot still blocks',
      rules: baseRuleSet(),
      facts: factsAt('MON', 0, 1440, { slotEnd: '2026-08-12T04:01:00.000Z' }),
      deps: depsWith(),
    },
    {
      name: 'classification: invalid IANA zone still blocks',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660, { timezone: 'Mars/Olympus' }),
      deps: depsWith(),
    },
    {
      name: 'DST spring-forward span (availability families skipped)',
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('SUN', 420, 1380)] },
      }),
      facts: factsOnDate(SPRING_FORWARD_DATE, 90, 240),
      deps: depsWith(),
    },
    {
      name: 'DST fall-back ambiguous morning (availability families skipped)',
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('SUN', 420, 1380)] },
      }),
      facts: factsOnDate(FALL_BACK_DATE, 60, 120),
      deps: depsWith(),
    },
    {
      name: 'subjectBookingId present but ignored (CANCEL semantics unchanged)',
      rules: baseRuleSet(),
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' } }),
    },
  ];

  it('the whole CANCEL scenario battery stays classification-only', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(20); // battery cannot silently shrink

    let sawCleanAllow = false;
    let sawRulesetInvalidBlock = false;
    let sawInvalidSlotBlock = false;
    for (const scenario of scenarios) {
      const outcome = evaluateRules(scenario.facts, scenario.rules, {
        ...scenario.deps,
        targetContext: { target: 'CANCEL', subjectBookingId: 'bk-subject-probe' },
      });
      expect(
        cancelTailViolations(outcome),
        `CANCEL scenario '${scenario.name}' leaked a non-classification explanation`,
      ).toEqual([]);
      if (outcome.decision === 'allow') {
        sawCleanAllow ||= outcome.explanations.some((e) => e.code === OUTCOME_CODES.bookingAllowed);
      }
      sawRulesetInvalidBlock ||= outcome.explanations.some(
        (e) => e.decision === 'block' && e.code === OUTCOME_CODES.rulesetInvalid,
      );
      sawInvalidSlotBlock ||= outcome.explanations.some(
        (e) => e.decision === 'block' && e.code === OUTCOME_CODES.invalidSlot,
      );
    }
    // Coverage floors: the battery really exercises allow AND both §5.3
    // fail-closed classification blocks, so the guard is not vacuously green.
    expect(sawCleanAllow, 'battery lost its clean-allow scenario').toBe(true);
    expect(sawRulesetInvalidBlock, 'battery lost its RULESET_INVALID scenario').toBe(true);
    expect(sawInvalidSlotBlock, 'battery lost its INVALID_SLOT scenario').toBe(true);
  });

  it('derives exactly the accepted forbidden-family injection set from the README CANCEL column', () => {
    const injections = forbiddenCancelInjections(readmeMatrix);
    expect(injections).toHaveLength(10);
    expect(new Set(injections.map((i) => `${i.ruleId}|${i.code}`))).toEqual(
      new Set([
        `entitlement|${OUTCOME_CODES.locationNotCovered}`,
        `entitlement|${OUTCOME_CODES.entitlementDegradedFailOpen}`,
        `exceptions|${OUTCOME_CODES.outsideBookingHours}`,
        `exceptions|${OUTCOME_CODES.dateClosed}`,
        `weekly-windows|${OUTCOME_CODES.outsideBookingHours}`,
        `weekly-windows|${OUTCOME_CODES.dateClosed}`,
        `limits|${OUTCOME_CODES.quotaExceeded}`,
        `limits|${OUTCOME_CODES.countUnavailableFailOpen}`,
        `duplicates|${OUTCOME_CODES.duplicateBooking}`,
        `duplicates|${OUTCOME_CODES.identityTimeConflict}`,
      ]),
    );
  });

  it('ANTI-VACUITY: the guard rejects EVERY forbidden family injected into a real CANCEL outcome (block and allow decisions)', () => {
    const pristine = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(pristine.decision).toBe('allow');
    expect(cancelTailViolations(pristine)).toEqual([]); // guard accepts the real outcome

    for (const injection of forbiddenCancelInjections(readmeMatrix)) {
      for (const decision of ['block', 'allow'] as const) {
        const drifted: RuleOutcome = {
          decision: pristine.decision,
          explanations: [
            ...pristine.explanations,
            {
              decision,
              ruleId: injection.ruleId,
              code: injection.code,
              customerMessage:
                'Synthetic notice from a future family that forgot the CANCEL branch.',
            },
          ],
        };
        expect(
          cancelTailViolations(drifted),
          `guard missed ${injection.ruleId}/${injection.code} injected as ${decision}`,
        ).not.toEqual([]);
      }
    }
  });

  it('ANTI-VACUITY (end-to-end drift mode): a simulated future notice-emitting family that forgets the CANCEL branch trips the guard', () => {
    // Models audit observation A verbatim: a future family appends its
    // fail-open notice without checking the target. Wrapped this way, EVERY
    // CANCEL evaluation leaks the family and the guard must flag it — while
    // the unwrapped evaluator stays clean.
    const simulateForgottenCancelBranch = (
      facts: BookingFacts,
      rules: RuleSet,
      deps: EvaluationDeps,
    ): RuleOutcome => {
      const outcome = evaluateRules(facts, rules, deps);
      return {
        ...outcome,
        explanations: [
          ...outcome.explanations,
          {
            decision: 'allow',
            ruleId: ENGINE_RULE_IDS.limits,
            code: OUTCOME_CODES.countUnavailableFailOpen,
            customerMessage:
              'Availability counting is temporarily unavailable; the limit check was skipped.',
          },
        ],
      };
    };

    const driftedOutcome = simulateForgottenCancelBranch(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(driftedOutcome.decision).toBe('allow'); // decision alone would NOT expose the leak…
    expect(cancelTailViolations(driftedOutcome)).not.toEqual([]); // …the guard does

    const cleanOutcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(cancelTailViolations(cleanOutcome)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Frozen canonical contract pin (cycle-5 canonical_contracts_notice)
// ---------------------------------------------------------------------------

describe('frozen ports.ts contract (docs/NEXT_CYCLE.json canonical_contracts_notice)', () => {
  it('ports.ts remains byte-identical to the accepted cycle-4 evolution (SHA-256 d46e0743…18802)', () => {
    const sha = createHash('sha256').update(readFileSync(PORTS_PATH)).digest('hex');
    expect(sha).toBe(
      'd46e0743fa825315a80456962d0f4412c02cbd437f0acabce909356f43c18802',
    );
  });
});
