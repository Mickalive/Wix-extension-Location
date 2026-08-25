/**
 * RuleSet validation suite.
 *
 * B2 REPAIR (audit CYCLE_32692407760_RULES): depth-2 import specifiers
 * ('../../src/domain' and './helpers/*') — the cycle-1 depth-3 specifiers
 * resolved above the repo root and the suite never loaded.
 */
import { describe, expect, it } from 'vitest';
import { RESERVED_RULE_IDS, validateRuleSet } from '../../src/domain';
import {
  baseRuleSet,
  weeklyWindow,
} from './helpers/builders';

describe('validateRuleSet — accepted shapes', () => {
  it('accepts an empty but well-formed RuleSet', () => {
    const result = validateRuleSet(baseRuleSet());
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('accepts split windows and the exclusive 24:00 end', () => {
    const result = validateRuleSet(
      baseRuleSet({
        locationWindows: {
          'loc-1': [weeklyWindow('WED', 540, 720), weeklyWindow('WED', 840, 1080)],
        },
        serviceWindows: { 'svc-1': [{ weekday: 'FRI', start: '09:00', end: '24:00' }] },
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateRuleSet — window problems', () => {
  it('rejects unknown weekdays and malformed times', () => {
    const result = validateRuleSet(
      baseRuleSet({
        serviceWindows: {
          'svc-1': [
            { weekday: 'WEEKEND' as never, start: '09:00', end: '10:00' },
            { weekday: 'MON', start: '9:00', end: '10:00' },
            { weekday: 'MON', start: '09:60', end: '10:00' },
          ],
        },
      }),
    );
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('serviceWindows.svc-1[0].weekday');
    expect(paths).toContain('serviceWindows.svc-1[1].start');
    expect(paths).toContain('serviceWindows.svc-1[2].start');
  });

  it('rejects inverted windows and a 24:00 START (legal only as exclusive end)', () => {
    const result = validateRuleSet(
      baseRuleSet({
        locationWindows: {
          'loc-1': [
            { weekday: 'TUE', start: '14:00', end: '09:00' },
            { weekday: 'TUE', start: '24:00', end: '24:00' },
          ],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('locationWindows.loc-1[0]');
    expect(result.issues.map((i) => i.path)).toContain('locationWindows.loc-1[1].start');
  });
});

describe('validateRuleSet — header fields', () => {
  it('requires non-empty id/revision and a positive integer version', () => {
    const result = validateRuleSet(
      baseRuleSet({ ruleSetId: '', revision: '', version: 0 }),
    );
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('ruleSetId');
    expect(paths).toContain('revision');
    expect(paths).toContain('version');
  });
});

describe('validateRuleSet — exceptions', () => {
  it('rejects impossible dates and OVERRIDE without windows', () => {
    const result = validateRuleSet(
      baseRuleSet({
        exceptions: [
          { exceptionId: 'exc-a', date: '2026-02-30', kind: 'CLOSED' },
          { exceptionId: 'exc-b', date: '2026-12-25', kind: 'OVERRIDE' },
          { exceptionId: 'exc-c', date: '2026-12-26', kind: 'OVERRIDE', windows: [] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('exceptions[0].date');
    expect(paths).toContain('exceptions[1].windows');
    expect(paths).toContain('exceptions[2].windows');
  });

  it('rejects duplicate exception ids', () => {
    const result = validateRuleSet(
      baseRuleSet({
        exceptions: [
          { exceptionId: 'dup', date: '2026-12-25', kind: 'CLOSED' },
          { exceptionId: 'dup', date: '2026-12-26', kind: 'CLOSED' },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DUPLICATE_ID')).toBe(true);
  });
});

describe('validateRuleSet — limits', () => {
  it('rejects bad maxCount, empty/unknown statuses, missing targets', () => {
    const result = validateRuleSet(
      baseRuleSet({
        limits: [
          { limitId: 'l1', dimension: 'DAY', maxCount: 0, includedStatuses: ['PENDING'] },
          { limitId: 'l2', dimension: 'DAY', maxCount: 3, includedStatuses: [] },
          { limitId: 'l3', dimension: 'DAY', maxCount: 3, includedStatuses: ['BANISHED' as never] },
          { limitId: 'l4', dimension: 'SERVICE', maxCount: 3, includedStatuses: ['PENDING'] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('limits[0].maxCount');
    expect(paths).toContain('limits[1].includedStatuses');
    expect(paths).toContain('limits[2].includedStatuses');
    expect(paths).toContain('limits[3].targetId');
  });

  it('A3 regression: rejects EVERY reserved rule id imported from primitives', () => {
    // The audit flagged a hardcoded copy of this list in validate.ts; the
    // repair imports RESERVED_RULE_IDS. This loop proves the validator and
    // the constant can no longer drift apart.
    for (const reserved of RESERVED_RULE_IDS) {
      const asLimit = validateRuleSet(
        baseRuleSet({
          limits: [
            { limitId: reserved, dimension: 'DAY', maxCount: 3, includedStatuses: ['PENDING'] },
          ],
        }),
      );
      expect(asLimit.valid, `limitId '${reserved}' must be rejected`).toBe(false);
      expect(asLimit.issues.some((i) => i.code === 'RESERVED_ID')).toBe(true);

      const asException = validateRuleSet(
        baseRuleSet({
          exceptions: [{ exceptionId: reserved, date: '2026-12-25', kind: 'CLOSED' }],
        }),
      );
      expect(asException.valid, `exceptionId '${reserved}' must be rejected`).toBe(false);
      expect(asException.issues.some((i) => i.code === 'RESERVED_ID')).toBe(true);
    }
  });

  it('tolerates a DAY limit carrying targetId (ignored by design)', () => {
    const result = validateRuleSet(
      baseRuleSet({
        limits: [
          { limitId: 'l1', dimension: 'DAY', targetId: 'whatever', maxCount: 3, includedStatuses: ['PENDING'] },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});
