/**
 * Caps suite: day/service/location limits, at-limit boundary semantics,
 * declared-status policy, site-zone day → UTC count bounds, and the fail-open
 * degraded-counter posture (Blueprint §4 flow 4).
 */
import { describe, expect, it } from 'vitest';
import type { CountQuery, EvaluationDeps, LimitDTO } from '../../../src/domain';
import { evaluateRules } from '../../../src/domain';
import {
  baseRuleSet,
  depsWith,
  factsAt,
} from '../helpers/builders';

/** Counter fake that records every query it is asked. */
function recordingCounter(results: Array<number | null>): {
  deps: EvaluationDeps;
  queries: CountQuery[];
} {
  const queries: CountQuery[] = [];
  let call = 0;
  return {
    queries,
    deps: depsWith({
      countForQuery: (q) => {
        queries.push(q);
        const value = results[call];
        call += 1;
        return value === undefined ? 0 : value;
      },
    }),
  };
}

describe('cap boundary semantics', () => {
  it('blocks exactly AT the limit and allows one-under (all three dimensions)', () => {
    const cases: Array<{ limit: LimitDTO; count: number; expectBlock: boolean }> = [
      {
        limit: { limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING', 'CONFIRMED'] },
        count: 2,
        expectBlock: true,
      },
      {
        limit: { limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING', 'CONFIRMED'] },
        count: 1,
        expectBlock: false,
      },
      {
        limit: { limitId: 'lim-svc', dimension: 'SERVICE', targetId: 'svc-1', maxCount: 3, includedStatuses: ['CONFIRMED'] },
        count: 3,
        expectBlock: true,
      },
      {
        limit: { limitId: 'lim-loc', dimension: 'LOCATION', targetId: 'loc-1', maxCount: 1, includedStatuses: ['PENDING'] },
        count: 1,
        expectBlock: true,
      },
    ];
    for (const c of cases) {
      const rules = baseRuleSet({ limits: [c.limit] });
      const outcome = evaluateRules(factsAt('WED', 600, 660), rules, recordingCounter([c.count]).deps);
      expect(outcome.decision).toBe(c.expectBlock ? 'block' : 'allow');
      if (c.expectBlock) {
        expect(outcome.explanations[0]?.code).toBe('QUOTA_EXCEEDED');
        expect(outcome.explanations[0]?.ruleId).toBe('limits');
      }
    }
  });

  it('forwards the DECLARED includedStatuses so cancellations free capacity', () => {
    const rules = baseRuleSet({
      limits: [
        { limitId: 'lim-day', dimension: 'DAY', maxCount: 5, includedStatuses: ['PENDING', 'CONFIRMED'] },
      ],
    });
    const { deps, queries } = recordingCounter([0]);
    evaluateRules(factsAt('WED', 600, 660), rules, deps);
    // CANCELED is absent from the forwarded statuses → a canceled booking can
    // never consume capacity.
    expect(queries[queries.length - 1]?.includedStatuses).toEqual(['PENDING', 'CONFIRMED']);
  });
});

describe('site-zone day → UTC count bounds (Contract §4.7)', () => {
  it('bounds the DAY query by the proposal’s SITE-ZONE day converted to UTC', () => {
    const rules = baseRuleSet({
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 4, includedStatuses: ['PENDING'] }],
    });
    const { deps, queries } = recordingCounter([0]);
    evaluateRules(factsAt('WED', 600, 660), rules, deps);
    // Wednesday Aug 12 2026 in New York (EDT, UTC−4):
    //   local midnight == 04:00Z; next local midnight == Aug 13 04:00Z.
    const q = queries[queries.length - 1];
    expect(q?.fromUtc).toBe('2026-08-12T04:00:00.000Z');
    expect(q?.toUtc).toBe('2026-08-13T04:00:00.000Z');
    expect(q?.serviceId).toBeUndefined();
    expect(q?.locationId).toBeUndefined();
  });

  it('narrows SERVICE/LOCATION limits to their target', () => {
    const rules = baseRuleSet({
      limits: [
        { limitId: 'lim-svc', dimension: 'SERVICE', targetId: 'svc-1', maxCount: 9, includedStatuses: ['PENDING'] },
        { limitId: 'lim-loc', dimension: 'LOCATION', targetId: 'loc-1', maxCount: 9, includedStatuses: ['PENDING'] },
      ],
    });
    const { deps, queries } = recordingCounter([0, 0]);
    evaluateRules(factsAt('WED', 600, 660), rules, deps);
    expect(queries[queries.length - 2]?.serviceId).toBe('svc-1');
    expect(queries[queries.length - 1]?.locationId).toBe('loc-1');
  });

  it('skips LOCATION limits when the proposal has no locationId (CUSTOM/CUSTOMER)', () => {
    const rules = baseRuleSet({
      limits: [
        { limitId: 'lim-loc', dimension: 'LOCATION', targetId: 'loc-1', maxCount: 1, includedStatuses: ['PENDING'] },
      ],
    });
    const { deps, queries } = recordingCounter([]);
    const outcome = evaluateRules(
      factsAt('WED', 600, 660, { locationId: null }),
      rules,
      deps,
    );
    expect(outcome.decision).toBe('allow');
    expect(queries).toHaveLength(0);
  });
});

describe('degraded counters — fail-open WITH visible notice', () => {
  it('a null count degrades the cap fail-open and surfaces an explanation', () => {
    const rules = baseRuleSet({
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
    });
    const outcome = evaluateRules(factsAt('WED', 600, 660), rules, recordingCounter([null]).deps);
    expect(outcome.decision).toBe('allow'); // never silently blocks on infra failure…
    expect(outcome.explanations.map((e) => e.code)).toContain('COUNT_UNAVAILABLE_FAIL_OPEN'); // …never silently allows either
  });

  it('a throwing counter is contained to the same fail-open notice', () => {
    const rules = baseRuleSet({
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
    });
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({
        countForQuery: () => {
          throw new Error('counter down');
        },
      }),
    );
    expect(outcome.decision).toBe('allow');
    expect(outcome.explanations.map((e) => e.code)).toContain('COUNT_UNAVAILABLE_FAIL_OPEN');
  });
});
