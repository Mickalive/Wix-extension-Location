/**
 * RuleSet configuration endpoint behaviors (INT-C2-1 item b; Blueprint §4
 * flow 2). Proves:
 *  - GET returns the active RuleSet (and a typed null when none exists);
 *  - PUT performs structural shape validation + optional domain-seam
 *    validation BEFORE any store write;
 *  - revision conflict surfaces REVISION_CONFLICT WITHOUT partial writes;
 *  - handlers validate shape + revision only (no business semantics).
 */
import { describe, expect, it } from 'vitest';
import {
  getActiveRuleSet,
  putRuleSet,
  validateRuleSetStructure,
} from '../../src/platform/http';
import type { RuleSetValidationIssue, RuleSetValidationSeam } from '../../src/platform/http';
import { FakeRulesConfigStore } from '../../src/platform/adapters/fakes/rulesConfigStore';
import { FakeTokenVerifier, VALID_TOKEN, makeConfigStoreSpy } from './helpers/httpTestDoubles';
import type { RuleSetDTO } from '../../src/shared/types';

function baseRuleSet(overrides?: Partial<RuleSetDTO>): RuleSetDTO {
  return {
    ruleSetId: 'rs-1',
    revision: 'rev-1',
    version: 1,
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
    ...overrides,
  };
}

interface Rig {
  inner: FakeRulesConfigStore;
  spy: ReturnType<typeof makeConfigStoreSpy>;
  callPut: (body: unknown, seam?: RuleSetValidationSeam) => Promise<unknown>;
  snapshot: () => Promise<RuleSetDTO | null>;
}

function makeRig(): Rig {
  const inner = new FakeRulesConfigStore({ initialRuleSet: baseRuleSet() });
  const spy = makeConfigStoreSpy(inner);
  const verifier = new FakeTokenVerifier();
  const callPut = async (body: unknown, seam?: RuleSetValidationSeam) =>
    putRuleSet(
      { tokenVerifier: verifier, configStore: spy, ...(seam ? { domainValidation: seam } : {}) },
      { authToken: VALID_TOKEN, body },
    );
  return { inner, spy, callPut, snapshot: () => inner.loadActiveRuleSet() };
}

describe('GET active RuleSet', () => {
  it('returns the active rule set', async () => {
    const rig = makeRig();
    const response = (await getActiveRuleSet(
      { tokenVerifier: new FakeTokenVerifier(), configStore: rig.inner },
      { authToken: VALID_TOKEN },
    )) as { status: number; body: { ruleSet: RuleSetDTO | null } };
    expect(response.status).toBe(200);
    expect(response.body.ruleSet?.ruleSetId).toBe('rs-1');
    expect(response.body.ruleSet?.revision).toBe('rev-1');
  });

  it('returns an explicit typed null when no rule set exists yet', async () => {
    const empty = new FakeRulesConfigStore();
    const response = (await getActiveRuleSet(
      { tokenVerifier: new FakeTokenVerifier(), configStore: empty },
      { authToken: VALID_TOKEN },
    )) as { status: number; body: { ruleSet: RuleSetDTO | null } };
    expect(response.status).toBe(200);
    expect(response.body.ruleSet).toBeNull();
  });
});

describe('PUT RuleSet happy path', () => {
  it('saves through the revision-checked store and returns the saved set', async () => {
    const rig = makeRig();
    const next = baseRuleSet({
      locationWindows: { 'loc-a': [{ weekday: 'MON', start: '09:00', end: '12:00' }] },
    });
    const response = (await rig.callPut({ ruleSet: next, expectedRevision: 'rev-1' })) as {
      status: number;
      body: { ruleSet: RuleSetDTO };
    };
    expect(response.status).toBe(200);
    expect(response.body.ruleSet.revision).toBe('rev-2');
    expect(rig.spy.saveCalls()).toBe(1);
    const stored = await rig.snapshot();
    expect(stored?.locationWindows['loc-a']).toHaveLength(1);
  });
});

describe('PUT RuleSet revision conflict surfaces REVISION_CONFLICT without partial writes', () => {
  it('rejects a stale expectedRevision and leaves the stored rule set untouched', async () => {
    const rig = makeRig();
    // Concurrent writer wins first; our request still carries the ORIGINAL revision.
    await rig.inner.saveRuleSet(baseRuleSet({ version: 2 }), 'rev-1');

    const proposed = baseRuleSet({
      version: 3,
      limits: [{ limitId: 'l1', dimension: 'DAY', maxCount: 5, includedStatuses: ['PENDING'] }],
    });
    let caught: unknown = null;
    try {
      await rig.callPut({ ruleSet: proposed, expectedRevision: 'rev-1' });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('REVISION_CONFLICT');
    expect((caught as { retriable?: boolean }).retriable).toBe(true);

    // ZERO partial writes: stored state is exactly the concurrent writer's.
    const stored = await rig.snapshot();
    expect(stored?.version).toBe(2);
    expect(stored?.limits).toHaveLength(0);
    expect(stored?.revision).toBe('rev-2');
  });
});

describe('PUT RuleSet validation ordering (shape + seam BEFORE any save)', () => {
  it('rejects structurally invalid bodies with INVALID_QUERY and zero store writes', async () => {
    const rig = makeRig();
    // Deliberately malformed fixture: invalid enum values must reach the
    // validator as-is, so this object is built untyped.
    const bad: Record<string, unknown> = {
      ...baseRuleSet(),
      locationWindows: { 'loc-a': [{ weekday: 'FUNDAY', start: '09:00', end: '12:00' }] },
      exceptions: [{ exceptionId: 'e1', date: '2026-02-30', kind: 'CLOSED' }],
      limits: [{ limitId: '', dimension: 'GALAXY', maxCount: -3, includedStatuses: ['NOPE'] }],
    };
    let caught: unknown = null;
    try {
      await rig.callPut({ ruleSet: bad, expectedRevision: 'rev-1' });
    } catch (error) {
      caught = error;
    }
    const err = caught as { code?: string; details?: { issues: RuleSetValidationIssue[] } };
    expect(err.code).toBe('INVALID_QUERY');
    const fields = err.details?.issues.map((i) => i.field) ?? [];
    expect(fields).toContain('locationWindows.loc-a[0].weekday');
    expect(fields).toContain('exceptions[0].date'); // calendar-validity check
    expect(fields).toContain('limits[0].dimension');
    expect(fields).toContain('limits[0].maxCount');
    expect(rig.spy.saveCalls()).toBe(0);
    expect(await rig.snapshot()).toMatchObject({ revision: 'rev-1', version: 1 });
  });

  it('rejects malformed envelopes (missing ruleSet / expectedRevision)', async () => {
    const rig = makeRig();
    for (const body of [undefined, {}, { ruleSet: baseRuleSet() }, { expectedRevision: 'rev-1' }]) {
      let caught: unknown = null;
      try {
        await rig.callPut(body);
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    }
    expect(rig.spy.saveCalls()).toBe(0);
  });

  it('invokes the domain validation seam and rejects its issues before saving', async () => {
    const rig = makeRig();
    const seamCalls: RuleSetDTO[] = [];
    const seam: RuleSetValidationSeam = {
      validate: (next) => {
        seamCalls.push(next);
        return [{ field: 'locationWindows', message: 'domain policy violation (stub)' }];
      },
    };
    let caught: unknown = null;
    try {
      await rig.callPut({ ruleSet: baseRuleSet(), expectedRevision: 'rev-1' }, seam);
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    expect(seamCalls).toHaveLength(1); // seam consulted exactly once
    expect(rig.spy.saveCalls()).toBe(0); // rejected BEFORE the store
    expect(await rig.snapshot()).toMatchObject({ revision: 'rev-1' });
  });

  it('a passing seam lets the save proceed', async () => {
    const rig = makeRig();
    const seam: RuleSetValidationSeam = { validate: () => [] };
    const response = (await rig.callPut({ ruleSet: baseRuleSet(), expectedRevision: 'rev-1' }, seam)) as {
      body: { ruleSet: RuleSetDTO };
    };
    expect(response.body.ruleSet.revision).toBe('rev-2');
    expect(rig.spy.saveCalls()).toBe(1);
  });
});

describe('structural validator is shape-only (no business semantics)', () => {
  it('accepts shapes that domain policy would judge (semantics are NOT here)', () => {
    // Equal start/end or inverted windows are POLICY questions for the rules
    // core via the seam; the platform layer must accept their SHAPE.
    const issues = validateRuleSetStructure(
      baseRuleSet({
        locationWindows: {
          'loc-a': [
            { weekday: 'MON', start: '18:00', end: '09:00' }, // inverted: allowed shape
            { weekday: 'TUE', start: '10:00', end: '10:00' }, // empty window: allowed shape
          ],
        },
        serviceWindows: { 'svc-1': [{ weekday: 'SUN', start: '23:59', end: '23:59' }] },
        exceptions: [
          { exceptionId: 'x1', date: '2026-12-25', kind: 'OVERRIDE', windows: [{ weekday: 'FRI', start: '10:00', end: '14:00' }] },
          { exceptionId: 'x2', date: '2026-01-01', kind: 'CLOSED' },
        ],
        limits: [
          { limitId: 'd1', dimension: 'DAY', maxCount: 0, includedStatuses: ['PENDING', 'CONFIRMED'] },
          { limitId: 's1', dimension: 'SERVICE', targetId: 'svc-1', maxCount: 100, includedStatuses: [] },
          { limitId: 'l1', dimension: 'LOCATION', targetId: 'loc-a', maxCount: 7, includedStatuses: ['CREATED'] },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('still rejects wrong types and malformed times/dates', () => {
    const issues = validateRuleSetStructure({
      ...baseRuleSet(),
      version: 0,
      locationWindows: { 'loc-a': [{ weekday: 'MON', start: '9:00', end: '24:00' }] },
      exceptions: [{ exceptionId: 'x1', date: '31-12-2026', kind: 'MAYBE' }],
    });
    const fields = issues.map((i) => i.field);
    expect(fields).toContain('version');
    expect(fields).toContain('locationWindows.loc-a[0].start');
    expect(fields).toContain('locationWindows.loc-a[0].end');
    expect(fields).toContain('exceptions[0].date');
    expect(fields).toContain('exceptions[0].kind');
  });
});
