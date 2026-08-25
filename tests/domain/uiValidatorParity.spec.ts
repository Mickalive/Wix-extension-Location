/**
 * Cross-lane validator parity contract — RULES-C3-1 (cycle 3).
 *
 * Obligation provenance:
 *  - Audit CYCLE_32692407760_DASHBOARD.md finding F-N1: the dashboard lane was
 *    forced to bundle provisional draft validators because the canonical
 *    `src/domain` validators did not exist yet; a cross-lane parity contract
 *    test was recorded as a Director-tracked obligation.
 *  - Audit CYCLE_32787032785_DASHBOARD.md section 5: the obligation was
 *    correctly deferred until the Rules lane achieved VERDICT: ACCEPT.
 *  - docs/NEXT_CYCLE.json lanes.rules (RULES-C3-1): discharge the obligation
 *    from the domain side now that the Rules ACCEPT exists.
 *
 * Methodology (fixed by the task text):
 *  1. A SHARED corpus of configuration drafts is defined once, in the UI
 *     draft shape, covering the six mandated families (valid draft, broken
 *     time rows, unknown weekdays, bad caps, overlapping windows, exception
 *     kind transitions) plus extra ledger entries that complete coverage.
 *  2. Each draft runs through BOTH validators:
 *     - the provisional plain-JS bundle `validateRuleDraft`
 *       (src/ui/validation/ruleDraftValidators.js, documented entry points),
 *     - the canonical pure validator `validateRuleSet` (src/domain barrel),
 *       fed by `draftToRuleSet()` below — the faithful draft→RuleSet
 *       translation a future mirror repoint must perform.
 *  3. Issue-code equivalence is asserted through the explicit mapping table
 *     `UI_TO_DOMAIN_CODES`. Every observed UI code must be classified there
 *     or listed in `UI_ONLY_CODES`; anything unclassified FAILS the suite so
 *     the ledger can never silently rot.
 *  4. Genuine semantic differences are NOT reconciled by weakening either
 *     side. They are pinned here as DECLARED DIVERGENCES with exact inputs
 *     and both outcomes (see `documented parity findings` below) and are
 *     reported in the builder task report as evidence for DASH/Director
 *     disposition. If either side ever drifts, these assertions fail.
 *
 * Hygiene: no deselection markers anywhere in this suite; every assertion is
 * active on every run. Pure and deterministic: no clocks, no I/O, no Wix SDK
 * imports on either side under test.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COUNT_INCLUDED_STATUSES,
  validateRuleSet,
  weekdayOfDate,
} from '../../src/domain';
import type {
  ExceptionDTO,
  ExceptionKind,
  LimitDTO,
  RuleSet,
  Weekday,
  WeeklyWindowDTO,
} from '../../src/domain';
// Dashboard-lane provisional validators (plain JS, documented entry points —
// see src/ui/README.md "Decisions of record" item 1 and validation/mirror.js).
import { validateRuleDraft } from '../../src/ui/validation/ruleDraftValidators.js';

/* ------------------------------------------------------------------ *
 * Parity ledger: provisional UI code → canonical domain code.
 *
 * Derived by hand from both implementations and locked by the corpus
 * below. Changing either validator in a way that breaks a mapping is a
 * breaking cross-lane change and must update this table consciously.
 * ------------------------------------------------------------------ */

const UI_TO_DOMAIN_CODES: Readonly<Record<string, string>> = {
  // Broken time rows (family 2)
  WINDOW_INCOMPLETE: 'INVALID_TIME',
  WINDOW_HALF_EMPTY: 'INVALID_TIME',
  WINDOW_BAD_START: 'INVALID_TIME',
  WINDOW_BAD_END: 'INVALID_TIME',
  WINDOW_ZERO_LENGTH: 'INVALID_WINDOW',
  WINDOW_END_BEFORE_START: 'INVALID_WINDOW',
  // Unknown weekday buckets (family 3)
  WEEKDAY_UNKNOWN: 'INVALID_WEEKDAY',
  // Cap values (family 4)
  LIMIT_NOT_INTEGER: 'INVALID_VALUE',
  LIMIT_NEGATIVE: 'INVALID_VALUE',
  // Exceptions (family 6 + ledger extras)
  EXCEPTION_DATE_MISSING: 'INVALID_VALUE',
  EXCEPTION_DATE_INVALID: 'INVALID_VALUE',
  EXCEPTION_KIND_UNKNOWN: 'INVALID_VALUE',
  EXCEPTION_OVERRIDE_EMPTY: 'INVALID_EXCEPTION',
  EXCEPTION_WINDOW_TIME_INVALID: 'INVALID_TIME',
  EXCEPTION_WINDOW_ORDER: 'INVALID_WINDOW',
};

/**
 * Provisional UI codes with NO canonical counterpart. Each one is a declared
 * divergence: the UI-side check is editorial (configuration UX policy) and
 * has no equivalent in `validateRuleSet`'s contract. See the findings block
 * at the bottom of this suite for exact inputs and both outcomes.
 */
const UI_ONLY_CODES: readonly string[] = [
  'WINDOW_OVERLAP', // Finding R2
  'EXCEPTION_DUPLICATE_DATE', // Finding R3
  'SCOPE_UNKNOWN', // Finding R4
];

type Classification =
  | { readonly kind: 'mapped'; readonly domain: string }
  | { readonly kind: 'uiOnly' };

/** Total classifier: refuses to guess. An unknown UI code fails the suite. */
function classifyUiCode(code: string): Classification {
  const mapped = UI_TO_DOMAIN_CODES[code];
  if (mapped !== undefined) return { kind: 'mapped', domain: mapped };
  if (UI_ONLY_CODES.includes(code)) return { kind: 'uiOnly' };
  throw new Error(
    `Unclassified provisional UI issue code "${code}". Extend the parity ` +
      'ledger consciously (mapping table or declared UI-only list) — never ' +
      'leave a cross-lane code difference undocumented.',
  );
}

/* ------------------------------------------------------------------ *
 * Shared corpus plumbing: the UI draft shape and its faithful
 * translation into the canonical RuleSet shape.
 * ------------------------------------------------------------------ */

interface DraftTimeRow {
  start: string;
  end: string;
}

/** Draft shape consumed by the dashboard's provisional validators. */
interface UiRuleDraft {
  locationWindows: Record<string, Record<string, DraftTimeRow[]>>;
  serviceWindows: Record<string, Record<string, DraftTimeRow[]>>;
  exceptions: Array<{
    exceptionId?: string;
    date: string;
    kind: string;
    windows?: DraftTimeRow[];
  }>;
  limits: Array<{
    dimension: 'DAY' | 'SERVICE' | 'LOCATION';
    targetId?: string | null;
    maxCount: number | string | null;
  }>;
}

interface SiteCatalogEntry {
  id: string;
  label: string;
}

function row(start: string, end: string): DraftTimeRow {
  return { start, end };
}

function collectWindows(
  buckets: UiRuleDraft['locationWindows'],
  out: Record<string, WeeklyWindowDTO[]>,
): void {
  for (const [scopeId, byWeekday] of Object.entries(buckets)) {
    const list: WeeklyWindowDTO[] = [];
    for (const [weekday, rows] of Object.entries(byWeekday)) {
      for (const draftRow of rows) {
        list.push({ weekday: weekday as Weekday, start: draftRow.start, end: draftRow.end });
      }
    }
    out[scopeId] = list;
  }
}

/**
 * A date-specific override window carries no weekday in the draft shape, but
 * the canonical `WeeklyWindowDTO` requires one and `validateRuleSet` enforces
 * it. The faithful translation derives it from the exception's own date (the
 * evaluator ignores weekday for override windows — see exceptions.ts — but
 * the structural validator does not). Invalid dates are flagged separately;
 * their synthesized weekday value is irrelevant, so a fixed fallback keeps
 * the converter total. This synthesis is knowledge the future mirror repoint
 * must preserve.
 */
function weekdayForExceptionDate(date: string): Weekday {
  try {
    return weekdayOfDate(date);
  } catch {
    return 'MON';
  }
}

function convertException(exception: UiRuleDraft['exceptions'][number], index: number): ExceptionDTO {
  const exceptionId =
    typeof exception.exceptionId === 'string' && exception.exceptionId !== ''
      ? exception.exceptionId
      : `draft-exception-${index}`;
  const converted: ExceptionDTO = {
    exceptionId,
    date: exception.date,
    kind: exception.kind as ExceptionKind,
  };
  if (exception.windows !== undefined) {
    const weekday = weekdayForExceptionDate(exception.date);
    converted.windows = exception.windows.map((w) => ({
      weekday,
      start: w.start,
      end: w.end,
    }));
  }
  return converted;
}

function convertLimits(draft: UiRuleDraft): LimitDTO[] {
  const out: LimitDTO[] = [];
  draft.limits.forEach((limit, index) => {
    // '' / null / undefined mean "no limit configured" in the editor store;
    // the faithful translation omits the limit entirely instead of storing a
    // placeholder cap.
    if (limit.maxCount === undefined || limit.maxCount === null || limit.maxCount === '') {
      return;
    }
    out.push({
      limitId: `parity-limit-${index}`,
      dimension: limit.dimension,
      ...(limit.targetId ? { targetId: limit.targetId } : {}),
      maxCount: limit.maxCount as number,
      includedStatuses: [...DEFAULT_COUNT_INCLUDED_STATUSES],
    });
  });
  return out;
}

/** The draft→RuleSet translation contract a mirror repoint must implement. */
function draftToRuleSet(draft: UiRuleDraft): RuleSet {
  const locationWindows: Record<string, WeeklyWindowDTO[]> = {};
  const serviceWindows: Record<string, WeeklyWindowDTO[]> = {};
  collectWindows(draft.locationWindows, locationWindows);
  collectWindows(draft.serviceWindows, serviceWindows);
  return {
    ruleSetId: 'parity-ruleset',
    revision: 'rev-parity',
    version: 1,
    locationWindows,
    serviceWindows,
    exceptions: draft.exceptions.map(convertException),
    limits: convertLimits(draft),
  };
}

/* ------------------------------------------------------------------ *
 * Corpus entries and the dual-execution parity runner.
 * ------------------------------------------------------------------ */

interface ParityEntry {
  readonly id: string;
  readonly family: string;
  readonly draft: UiRuleDraft;
  readonly locations: readonly SiteCatalogEntry[];
  readonly services: readonly SiteCatalogEntry[];
  /** Exact distinct UI issue codes expected (sorted). */
  readonly expectedUiCodes: readonly string[];
  /** Exact distinct canonical issue codes expected (sorted). */
  readonly expectedDomainCodes: readonly string[];
  /** Declared UI-only codes responsible for any UI/domain asymmetry. */
  readonly uiOnlyCodes?: readonly string[];
  /** Declared domain-only codes responsible for any UI/domain asymmetry. */
  readonly domainOnlyCodes?: readonly string[];
  readonly note?: string;
}

function sortedUnique(codes: readonly string[]): string[] {
  return [...new Set(codes)].sort();
}

function runParity(entry: ParityEntry): void {
  const uiIssues = validateRuleDraft(entry.draft, [...entry.locations], [...entry.services]);
  const uiCodes = sortedUnique(uiIssues.map((issue) => issue.code));

  const domainResult = validateRuleSet(draftToRuleSet(entry.draft));
  const domainCodes = sortedUnique(domainResult.issues.map((issue) => issue.code));

  // Pin BOTH sides exactly: any drift on either side is a concrete finding.
  expect(uiCodes, `[${entry.id}] provisional UI codes`).toEqual(entry.expectedUiCodes);
  expect(domainCodes, `[${entry.id}] canonical domain codes`).toEqual(entry.expectedDomainCodes);

  // Ledger totality: every observed UI code must be consciously classified.
  for (const code of uiCodes) classifyUiCode(code);

  // Equivalence through the mapping, minus the declared divergences.
  const uiSide = new Set<string>();
  for (const code of uiCodes) {
    const classification = classifyUiCode(code);
    if (classification.kind === 'mapped') uiSide.add(classification.domain);
  }
  const domainSide = new Set(domainCodes);
  for (const code of entry.uiOnlyCodes ?? []) uiSide.delete(code);
  for (const code of entry.domainOnlyCodes ?? []) domainSide.delete(code);
  expect(
    [...uiSide].sort(),
    `[${entry.id}] mapped UI codes vs canonical codes (note: ${entry.note ?? 'n/a'})`,
  ).toEqual([...domainSide].sort());
}

const EMPTY_DRAFT: UiRuleDraft = {
  locationWindows: {},
  serviceWindows: {},
  exceptions: [],
  limits: [],
};

const L1: SiteCatalogEntry = { id: 'l1', label: 'Downtown' };
const S1: SiteCatalogEntry = { id: 's1', label: 'Consultation' };

/* ------------------------------------- *
 * Family 1 — fully valid draft (both sides clean)
 * ------------------------------------- */

const F1_VALID: ParityEntry = {
  id: 'F1-valid-full-draft',
  family: '1: fully valid draft',
  draft: {
    locationWindows: { l1: { MON: [row('09:00', '12:00'), row('14:00', '18:00')] } },
    serviceWindows: { s1: { TUE: [row('10:00', '13:00')] } },
    exceptions: [
      { exceptionId: 'exc-closed', date: '2026-12-25', kind: 'CLOSED' },
      {
        exceptionId: 'exc-override',
        date: '2026-12-31',
        kind: 'OVERRIDE',
        windows: [row('10:00', '14:00')],
      },
    ],
    limits: [
      { dimension: 'DAY', maxCount: 20 },
      { dimension: 'SERVICE', targetId: 's1', maxCount: 5 },
      { dimension: 'LOCATION', targetId: 'l1', maxCount: 15 },
    ],
  },
  locations: [L1],
  services: [S1],
  expectedUiCodes: [],
  expectedDomainCodes: [],
  note: 'split hours, CLOSED + OVERRIDE-with-hours, DAY/SERVICE/LOCATION caps',
};

/* ------------------------------------- *
 * Family 2 — incomplete / invalid time rows
 * ------------------------------------- */

function timeRowEntry(
  id: string,
  label: string,
  draftRow: DraftTimeRow,
  expectedUiCodes: readonly string[],
  expectedDomainCodes: readonly string[],
): ParityEntry {
  return {
    id,
    family: `2: ${label}`,
    draft: { ...EMPTY_DRAFT, locationWindows: { l1: { MON: [draftRow] } } },
    locations: [L1],
    services: [],
    expectedUiCodes,
    expectedDomainCodes,
  };
}

const F2_ENTRIES: readonly ParityEntry[] = [
  timeRowEntry(
    'F2a-row-completely-empty',
    'completely empty row is incomplete input',
    row('', ''),
    ['WINDOW_INCOMPLETE'],
    ['INVALID_TIME'],
  ),
  timeRowEntry(
    'F2b-row-half-empty',
    'half-empty row (missing end)',
    row('09:00', ''),
    ['WINDOW_HALF_EMPTY'],
    ['INVALID_TIME'],
  ),
  timeRowEntry(
    'F2c-malformed-times',
    'malformed start and end times',
    row('9am', '25:00'),
    // Expected arrays are compared against sorted distinct codes.
    ['WINDOW_BAD_END', 'WINDOW_BAD_START'],
    ['INVALID_TIME'],
  ),
  timeRowEntry(
    'F2d-end-before-start',
    'inverted window',
    row('14:00', '09:00'),
    ['WINDOW_END_BEFORE_START'],
    ['INVALID_WINDOW'],
  ),
  timeRowEntry(
    'F2e-zero-length',
    'zero-length window',
    row('10:00', '10:00'),
    ['WINDOW_ZERO_LENGTH'],
    ['INVALID_WINDOW'],
  ),
];

/* ------------------------------------- *
 * Family 3 — unknown weekday keys
 * ------------------------------------- */

const F3_UNKNOWN_WEEKDAY: ParityEntry = {
  id: 'F3-unknown-weekday-bucket',
  family: '3: unknown weekday key',
  draft: {
    ...EMPTY_DRAFT,
    locationWindows: { l1: { SUNDAYS: [row('09:00', '12:00')] } },
  },
  locations: [L1],
  services: [],
  expectedUiCodes: ['WEEKDAY_UNKNOWN'],
  expectedDomainCodes: ['INVALID_WEEKDAY'],
  note: 'non-canonical bucket key; UI skips row checks for it, domain flags the translated window weekday',
};

/* ------------------------------------- *
 * Family 4 — non-integer / negative cap values
 * ------------------------------------- */

function capEntry(
  id: string,
  label: string,
  maxCount: number | string,
  expectedUiCodes: readonly string[],
  expectedDomainCodes: readonly string[],
  divergence?: { uiOnlyCodes?: readonly string[]; domainOnlyCodes?: readonly string[] },
): ParityEntry {
  return {
    id,
    family: `4: ${label}`,
    draft: {
      ...EMPTY_DRAFT,
      limits: [{ dimension: 'SERVICE', targetId: 's1', maxCount }],
    },
    locations: [],
    services: [S1],
    expectedUiCodes,
    expectedDomainCodes,
    ...divergence,
  };
}

const F4_ENTRIES: readonly ParityEntry[] = [
  capEntry('F4a-fractional-cap', 'fractional cap 1.5', 1.5, ['LIMIT_NOT_INTEGER'], ['INVALID_VALUE']),
  capEntry('F4b-negative-cap', 'negative cap -3', -3, ['LIMIT_NEGATIVE'], ['INVALID_VALUE']),
  capEntry(
    'F4c-zero-cap',
    'zero cap 0 (declared divergence R1)',
    0,
    [],
    ['INVALID_VALUE'],
    { domainOnlyCodes: ['INVALID_VALUE'] },
  ),
];

/* ------------------------------------- *
 * Family 5 — overlapping duplicate windows (same scope + weekday)
 * ------------------------------------- */

function windowPairEntry(
  id: string,
  label: string,
  rows: readonly DraftTimeRow[],
  expectedUiCodes: readonly string[],
  expectedDomainCodes: readonly string[],
  divergence?: { uiOnlyCodes?: readonly string[] },
): ParityEntry {
  return {
    id,
    family: `5: ${label}`,
    draft: { ...EMPTY_DRAFT, locationWindows: { l1: { WED: [...rows] } } },
    locations: [L1],
    services: [],
    expectedUiCodes,
    expectedDomainCodes,
    ...divergence,
  };
}

const F5_ENTRIES: readonly ParityEntry[] = [
  windowPairEntry(
    'F5a-partial-overlap',
    'partially overlapping pair (declared divergence R2)',
    [row('09:00', '12:00'), row('11:00', '13:00')],
    ['WINDOW_OVERLAP'],
    [],
    { uiOnlyCodes: ['WINDOW_OVERLAP'] },
  ),
  windowPairEntry(
    'F5b-exact-duplicate-windows',
    'exact duplicate windows (declared divergence R2)',
    [row('09:00', '12:00'), row('09:00', '12:00')],
    ['WINDOW_OVERLAP'],
    [],
    { uiOnlyCodes: ['WINDOW_OVERLAP'] },
  ),
  windowPairEntry(
    'F5c-adjacent-control',
    'adjacent (back-to-back) windows are legal on both sides',
    [row('09:00', '12:00'), row('12:00', '14:00')],
    [],
    [],
  ),
];

/* ------------------------------------- *
 * Family 6 — exception kind transitions
 * ------------------------------------- */

function exceptionEntry(
  id: string,
  label: string,
  exceptions: UiRuleDraft['exceptions'],
  expectedUiCodes: readonly string[],
  expectedDomainCodes: readonly string[],
  divergence?: { uiOnlyCodes?: readonly string[] },
): ParityEntry {
  return {
    id,
    family: `6: ${label}`,
    draft: { ...EMPTY_DRAFT, exceptions },
    locations: [],
    services: [],
    expectedUiCodes,
    expectedDomainCodes,
    ...divergence,
  };
}

const F6_ENTRIES: readonly ParityEntry[] = [
  exceptionEntry(
    'F6-t0-closed-valid',
    'transition start: CLOSED all-day is valid',
    [{ exceptionId: 'exc-1', date: '2026-12-25', kind: 'CLOSED' }],
    [],
    [],
  ),
  exceptionEntry(
    'F6-t1-closed-to-override-with-hours',
    'CLOSED -> OVERRIDE with hours is valid',
    [
      {
        exceptionId: 'exc-1',
        date: '2026-12-31',
        kind: 'OVERRIDE',
        windows: [row('10:00', '14:00')],
      },
    ],
    [],
    [],
  ),
  exceptionEntry(
    'F6-t2-override-hours-removed',
    'OVERRIDE whose hours were removed is rejected on both sides',
    [{ exceptionId: 'exc-1', date: '2026-12-31', kind: 'OVERRIDE', windows: [] }],
    ['EXCEPTION_OVERRIDE_EMPTY'],
    ['INVALID_EXCEPTION'],
  ),
  exceptionEntry(
    'F6-t3-override-removed-back-to-closed',
    'removing the OVERRIDE (back to CLOSED) is valid again',
    [{ exceptionId: 'exc-1', date: '2026-12-31', kind: 'CLOSED' }],
    [],
    [],
  ),
  exceptionEntry(
    'F6-t4-stale-windows-on-closed-control',
    'control: stale windows attached to a CLOSED entry are ignored identically',
    [
      {
        exceptionId: 'exc-1',
        date: '2026-12-25',
        kind: 'CLOSED',
        windows: [row('10:00', '14:00')],
      },
    ],
    [],
    [],
  ),
  exceptionEntry(
    'F6-t5-override-inverted-hours',
    'OVERRIDE with inverted hours',
    [
      {
        exceptionId: 'exc-1',
        date: '2026-12-31',
        kind: 'OVERRIDE',
        windows: [row('14:00', '09:00')],
      },
    ],
    ['EXCEPTION_WINDOW_ORDER'],
    ['INVALID_WINDOW'],
  ),
  exceptionEntry(
    'F6-t6-override-malformed-hour',
    'OVERRIDE with a malformed hour',
    [
      {
        exceptionId: 'exc-1',
        date: '2026-12-31',
        kind: 'OVERRIDE',
        windows: [{ start: 'abc', end: '10:00' }],
      },
    ],
    ['EXCEPTION_WINDOW_TIME_INVALID'],
    ['INVALID_TIME'],
  ),
];

/* ------------------------------------- *
 * Ledger extras — complete the code universes on both sides
 * ------------------------------------- */

const LEDGER_EXTRA_ENTRIES: readonly ParityEntry[] = [
  exceptionEntry(
    'X1-duplicate-exception-dates',
    'two exceptions on one date (declared divergence R3)',
    [
      { exceptionId: 'x1', date: '2026-12-24', kind: 'CLOSED' },
      { exceptionId: 'x2', date: '2026-12-24', kind: 'CLOSED' },
    ],
    ['EXCEPTION_DUPLICATE_DATE'],
    [],
    { uiOnlyCodes: ['EXCEPTION_DUPLICATE_DATE'] },
  ),
  {
    // Built inline (not via exceptionEntry) because its ghost scope lives in
    // serviceWindows rather than in the exceptions list.
    id: 'X2-unknown-window-scope',
    family: 'extras: windows referencing a scope absent from the site catalog (declared divergence R4)',
    draft: { ...EMPTY_DRAFT, serviceWindows: { ghost: { MON: [row('09:00', '10:00')] } } },
    locations: [],
    services: [S1],
    expectedUiCodes: ['SCOPE_UNKNOWN'],
    expectedDomainCodes: [],
    uiOnlyCodes: ['SCOPE_UNKNOWN'],
  },
  exceptionEntry(
    'X3-missing-exception-date',
    'exception without a date',
    [{ exceptionId: 'x3', date: '', kind: 'CLOSED' }],
    ['EXCEPTION_DATE_MISSING'],
    ['INVALID_VALUE'],
  ),
  exceptionEntry(
    'X4-impossible-exception-date',
    'exception on a non-existent calendar date',
    [{ exceptionId: 'x4', date: '2026-02-30', kind: 'CLOSED' }],
    ['EXCEPTION_DATE_INVALID'],
    ['INVALID_VALUE'],
  ),
  exceptionEntry(
    'X5-unknown-exception-kind',
    'exception with an unknown kind',
    [{ exceptionId: 'x5', date: '2026-12-25', kind: 'BANISHED' }],
    ['EXCEPTION_KIND_UNKNOWN'],
    ['INVALID_VALUE'],
  ),
];

const ALL_ENTRIES: readonly ParityEntry[] = [
  F1_VALID,
  ...F2_ENTRIES,
  F3_UNKNOWN_WEEKDAY,
  ...F4_ENTRIES,
  ...F5_ENTRIES,
  ...F6_ENTRIES,
  ...LEDGER_EXTRA_ENTRIES,
];

/* ------------------------------------------------------------------ *
 * The parity contract, family by family.
 * ------------------------------------------------------------------ */

describe('UI validator ↔ canonical domain validator parity (RULES-C3-1)', () => {
  for (const entry of ALL_ENTRIES) {
    it(`family ${entry.family} — ${entry.id}`, () => {
      runParity(entry);
    });
  }

  it('ledger integrity: every classified UI code and every mapping target is exercised by the corpus', () => {
    const observedUi = new Set<string>();
    const observedDomain = new Set<string>();
    for (const entry of ALL_ENTRIES) {
      for (const code of validateRuleDraft(entry.draft, [...entry.locations], [...entry.services])) {
        observedUi.add(code.code);
      }
      for (const issue of validateRuleSet(draftToRuleSet(entry.draft)).issues) {
        observedDomain.add(issue.code);
      }
    }
    const declaredUiUniverse = new Set([
      ...Object.keys(UI_TO_DOMAIN_CODES),
      ...UI_ONLY_CODES,
    ]);
    const declaredDomainUniverse = new Set(Object.values(UI_TO_DOMAIN_CODES));
    expect(
      [...declaredUiUniverse].sort(),
      'every declared UI classification must be exercised (no dead ledger entries)',
    ).toEqual([...observedUi].sort());
    expect(
      [...declaredDomainUniverse].sort(),
      'every mapping target must be exercised (no dead ledger entries)',
    ).toEqual([...observedDomain].sort());
  });
});

/* ------------------------------------------------------------------ *
 * Documented parity findings — evidence for DASH/Director disposition.
 *
 * These are REAL semantic differences between the provisional UI
 * validators and the canonical validator. Per the task text they are
 * neither silently reconciled nor papered over: each is pinned here with
 * exact inputs and BOTH outcomes, and reported in the builder task
 * report. Neither implementation was weakened to reach agreement.
 * ------------------------------------------------------------------ */

describe('documented parity findings (concrete evidence, never silently reconciled)', () => {
  it('R1: a zero cap is accepted by the UI but rejected by the canonical validator', () => {
    // Exact input: limits [{dimension DAY, maxCount 0}].
    const draft: UiRuleDraft = {
      ...EMPTY_DRAFT,
      limits: [{ dimension: 'DAY', maxCount: 0 }],
    };
    // UI outcome: 0 is a valid configured cap ("integers >= 0").
    expect(validateRuleDraft(draft)).toEqual([]);
    // Canonical outcome: maxCount must be an integer of at least 1.
    const domain = validateRuleSet(draftToRuleSet(draft));
    expect(domain.valid).toBe(false);
    expect(domain.issues.map((i) => i.code)).toEqual(['INVALID_VALUE']);
    // Disposition needed: either the editor must forbid 0 (canonical floor
    // is 1) or the seam must define the 0 translation explicitly.
  });

  it('R2: overlapping weekly windows are blocked by the UI but structurally valid canonically', () => {
    // Exact input: l1 WED 09:00-12:00 + 11:00-13:00.
    const draft: UiRuleDraft = {
      ...EMPTY_DRAFT,
      locationWindows: { l1: { WED: [row('09:00', '12:00'), row('11:00', '13:00')] } },
    };
    // UI outcome: split hours must not intersect.
    expect(validateRuleDraft(draft).map((i) => i.code)).toEqual(['WINDOW_OVERLAP']);
    // Canonical outcome: each window is individually valid; evaluation unions
    // overlapping windows (normalizeWindows), so no structural issue exists.
    const domain = validateRuleSet(draftToRuleSet(draft));
    expect(domain.valid).toBe(true);
    expect(domain.issues).toEqual([]);
    // Disposition needed: decide whether overlap checking survives the
    // mirror repoint as an explicit UI-only advisory check or is dropped —
    // it must not silently disappear either way.
  });

  it('R3: duplicate exception dates are flagged by the UI but permitted canonically', () => {
    // Exact input: x1 + x2, both CLOSED on 2026-12-24, distinct ids.
    const draft: UiRuleDraft = {
      ...EMPTY_DRAFT,
      exceptions: [
        { exceptionId: 'x1', date: '2026-12-24', kind: 'CLOSED' },
        { exceptionId: 'x2', date: '2026-12-24', kind: 'CLOSED' },
      ],
    };
    // UI outcome: merge-before-save editorial rule, raised on both entries.
    expect(validateRuleDraft(draft).map((i) => i.code)).toEqual([
      'EXCEPTION_DUPLICATE_DATE',
      'EXCEPTION_DUPLICATE_DATE',
    ]);
    // Canonical outcome: distinct ids are unique; the evaluator supports
    // multiple exceptions per date (CLOSED beats OVERRIDE; overrides intersect).
    const domain = validateRuleSet(draftToRuleSet(draft));
    expect(domain.valid).toBe(true);
    expect(domain.issues).toEqual([]);
    // Disposition needed: keep as documented UI simplification or align.
  });

  it('R4: unknown window scopes are flagged by the UI only — the canonical validator has no catalog input', () => {
    // Exact input: serviceWindows.ghost MON 09:00-10:00; catalog contains s1 only.
    const draft: UiRuleDraft = {
      ...EMPTY_DRAFT,
      serviceWindows: { ghost: { MON: [row('09:00', '10:00')] } },
    };
    // UI outcome: scope existence checked against the passed site catalog.
    expect(validateRuleDraft(draft, [], [S1]).map((i) => i.code)).toEqual(['SCOPE_UNKNOWN']);
    // Canonical outcome: validateRuleSet(rules) has no site-catalog parameter;
    // the window itself is structurally valid.
    const domain = validateRuleSet(draftToRuleSet(draft));
    expect(domain.valid).toBe(true);
    expect(domain.issues).toEqual([]);
    // Disposition needed: catalog-existence checks must survive a mirror
    // repoint OUTSIDE the canonical validator (seam responsibility).
  });
});
