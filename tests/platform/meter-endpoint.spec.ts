/**
 * INT-C4-1(c) — token-verified GET /meter endpoint with the PINNED DTO
 * (cross-lane contract with DASH-C4-1; Blueprint §1 pages/LocationsUsage
 * data source; Contract §6 fail-closed auth, §7/C5 fail-open posture).
 *
 * Proves:
 *  - the response body shape is EXACTLY the pinned DTO (key sets + types);
 *  - unauthenticated requests reject 401 UNAUTHORIZED before ANY gate call;
 *  - gate failures degrade IN-BODY (fail-open) — status stays 200, never a
 *    5xx that would block the dashboard;
 *  - healthy paths propagate accepted billing outputs verbatim.
 */
import { describe, expect, it } from 'vitest';
import { getEntitlementMeter, httpResponseForError } from '../../src/platform/http';
import type {
  EntitlementMeterResponse,
  MeterSourceGate,
} from '../../src/platform/http';
import { UnauthorizedRequestError } from '../../src/platform/http/auth';
import type { PolicyDecision } from '../../src/domain/ports';
import { FakeTokenVerifier, VALID_TOKEN, expectUnauthorized } from './helpers/httpTestDoubles';

// ------------------------------------------------------------- test doubles

class StubGate implements MeterSourceGate {
  constructor(
    private readonly decision: PolicyDecision,
    private readonly reading: { count: number | null; degraded: boolean },
    private readonly failMeterWith: Error | null = null,
    private readonly failCoverageWith: Error | null = null,
  ) {}

  meterCalls = 0;
  coverageCalls = 0;

  async meter(): Promise<{ count: number | null; degraded: boolean }> {
    this.meterCalls += 1;
    if (this.failMeterWith) throw this.failMeterWith;
    return { ...this.reading };
  }

  async allowedLocationIds(): Promise<PolicyDecision> {
    this.coverageCalls += 1;
    if (this.failCoverageWith) throw this.failCoverageWith;
    return structuredClone(this.decision);
  }
}

function healthyDecision(overrides?: Partial<PolicyDecision>): PolicyDecision {
  return {
    allowedLocationIds: ['loc-a', 'loc-b'],
    overLimit: true,
    degraded: false,
    warning: null,
    ...overrides,
  };
}

async function call(
  gate: MeterSourceGate,
  authToken?: string | null,
  verifier?: FakeTokenVerifier,
): Promise<EntitlementMeterResponse | never> {
  const response = await getEntitlementMeter(
    { tokenVerifier: verifier ?? new FakeTokenVerifier(), entitlementGate: gate },
    { authToken: authToken === undefined ? VALID_TOKEN : authToken },
  );
  expect(response.status).toBe(200);
  return response.body;
}

/** Recursive pinned-shape guard: exact key sets and value types, no extras. */
function assertPinnedShape(body: unknown): void {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  expect(Array.isArray(body)).toBe(false);
  const root = body as Record<string, unknown>;
  expect(Object.keys(root).sort()).toEqual(['coverage', 'meter']);

  const meter = root.meter as Record<string, unknown>;
  expect(Object.keys(meter).sort()).toEqual(['count', 'degraded']);
  expect(meter.count === null || typeof meter.count === 'number').toBe(true);
  expect(typeof meter.degraded).toBe('boolean');

  const coverage = root.coverage as Record<string, unknown>;
  expect(Object.keys(coverage).sort()).toEqual([
    'allowedLocationIds',
    'degraded',
    'overLimit',
    'warning',
  ]);
  expect(Array.isArray(coverage.allowedLocationIds)).toBe(true);
  for (const id of coverage.allowedLocationIds as unknown[]) {
    expect(typeof id).toBe('string');
  }
  expect(typeof coverage.overLimit).toBe('boolean');
  expect(typeof coverage.degraded).toBe('boolean');
  expect(coverage.warning === null || typeof coverage.warning === 'string').toBe(true);
}

// ------------------------------------------------------------------- tests

describe('GET /meter — pinned DTO', () => {
  it('healthy path returns EXACTLY the pinned body composed from gate.meter() + gate.allowedLocationIds()', async () => {
    const gate = new StubGate(healthyDecision(), { count: 7, degraded: false });
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body).toEqual({
      meter: { count: 7, degraded: false },
      coverage: {
        allowedLocationIds: ['loc-a', 'loc-b'],
        overLimit: true,
        degraded: false,
        warning: null,
      },
    });
    expect(gate.meterCalls).toBe(1);
    expect(gate.coverageCalls).toBe(1);
  });

  it('a missing warning key normalizes to warning:null and ordering of allowed ids is preserved verbatim', async () => {
    const decision = healthyDecision();
    delete (decision as { warning?: string | null }).warning;
    const gate = new StubGate(decision, { count: 0, degraded: false });
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body.coverage.warning).toBeNull();
    expect(body.coverage.allowedLocationIds).toEqual(['loc-a', 'loc-b']);
    expect(body.meter).toEqual({ count: 0, degraded: false });
  });
});

describe('GET /meter — authentication is fail-closed BEFORE any gate interaction', () => {
  it('missing token (absent, empty, whitespace) rejects TOKEN_MISSING → 401 UNAUTHORIZED', async () => {
    for (const authToken of [null, '', '   ']) {
      const gate = new StubGate(healthyDecision(), { count: 1, degraded: false });
      let caught: unknown = null;
      try {
        await getEntitlementMeter(
          { tokenVerifier: new FakeTokenVerifier(), entitlementGate: gate },
          { authToken },
        );
      } catch (error) {
        caught = error;
      }
      expectUnauthorized(caught, 'TOKEN_MISSING');
      const mapped = httpResponseForError(caught);
      expect(mapped.status).toBe(401);
      expect(mapped.body.error.code).toBe('UNAUTHORIZED');
      expect(gate.meterCalls).toBe(0);
      expect(gate.coverageCalls).toBe(0);
    }
  });

  it('invalid/expired token rejects TOKEN_INVALID → 401 UNAUTHORIZED with zero gate calls', async () => {
    const gate = new StubGate(healthyDecision(), { count: 1, degraded: false });
    let caught: unknown = null;
    try {
      await getEntitlementMeter(
        { tokenVerifier: new FakeTokenVerifier(), entitlementGate: gate },
        { authToken: 'forged-token' },
      );
    } catch (error) {
      caught = error;
    }
    expectUnauthorized(caught, 'TOKEN_INVALID');
    expect(httpResponseForError(caught).status).toBe(401);
    expect(gate.meterCalls).toBe(0);
    expect(gate.coverageCalls).toBe(0);
  });

  it('verifier infrastructure failure rejects TOKEN_VERIFIER_FAILED (never authorizes)', async () => {
    const verifier = new FakeTokenVerifier();
    verifier.throwWith = new Error('token info outage');
    const gate = new StubGate(healthyDecision(), { count: 1, degraded: false });
    let caught: unknown = null;
    try {
      await getEntitlementMeter({ tokenVerifier: verifier, entitlementGate: gate }, { authToken: VALID_TOKEN });
    } catch (error) {
      caught = error;
    }
    expectUnauthorized(caught, 'TOKEN_VERIFIER_FAILED');
    expect(caught).toBeInstanceOf(UnauthorizedRequestError);
    expect(gate.meterCalls).toBe(0);
    expect(gate.coverageCalls).toBe(0);
  });
});

describe('GET /meter — gate failures degrade in-body (fail-open §7/C5), never 5xx', () => {
  it('failing meter degrades ONLY its half; coverage stays healthy', async () => {
    const gate = new StubGate(
      healthyDecision(),
      { count: null, degraded: true },
      new Error('billable count outage'),
    );
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body.meter).toEqual({ count: null, degraded: true });
    expect(body.coverage.degraded).toBe(false);
    expect(body.coverage.allowedLocationIds).toEqual(['loc-a', 'loc-b']);
  });

  it('failing coverage degrades ONLY its half with the explicit fail-open warning; meter stays healthy', async () => {
    const gate = new StubGate(
      healthyDecision(),
      { count: 3, degraded: false },
      null,
      new Error('listing outage'),
    );
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body.meter).toEqual({ count: 3, degraded: false });
    expect(body.coverage).toEqual({
      allowedLocationIds: [],
      overLimit: false,
      degraded: true,
      warning:
        'Entitlement coverage is temporarily unavailable — failing open; no booking is blocked on billing errors.',
    });
  });

  it('both halves failing yields the fully degraded pinned body at status 200', async () => {
    const gate = new StubGate(
      healthyDecision(),
      { count: null, degraded: true },
      new Error('count outage'),
      new Error('gate outage'),
    );
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body).toEqual({
      meter: { count: null, degraded: true },
      coverage: {
        allowedLocationIds: [],
        overLimit: false,
        degraded: true,
        warning:
          'Entitlement coverage is temporarily unavailable — failing open; no booking is blocked on billing errors.',
      },
    });
  });

  it('an ALREADY-degraded coverage decision (e.g. location-listing failure inside the accepted gate) flows through verbatim', async () => {
    // Exactly the PolicyDecision createEntitlementGate returns when its
    // listing port throws: empty ids + degraded flag + warning text.
    const gate = new StubGate(
      {
        allowedLocationIds: [],
        overLimit: false,
        degraded: true,
        warning: 'Location listing unavailable — entitlement coverage temporarily unknown.',
      },
      { count: 4, degraded: false },
    );
    const body = await call(gate);
    assertPinnedShape(body);
    expect(body.coverage).toEqual({
      allowedLocationIds: [],
      overLimit: false,
      degraded: true,
      warning: 'Location listing unavailable — entitlement coverage temporarily unknown.',
    });
    expect(body.meter).toEqual({ count: 4, degraded: false });
  });

  it('integration: the REAL composed gate turns a failing billable-count port into {count:null, degraded:true}', async () => {
    const { composeValidationEntitlement } = await import('../../src/platform/composition');
    const composition = composeValidationEntitlement({
      listings: {
        listManagedLocations: async () => [
          { locationId: 'loc-default', archived: false, isDefault: true },
        ],
      },
      billableCount: {
        countBillable: async (): Promise<never> => {
          throw new Error('Count Extended Bookings outage');
        },
      },
      warnings: {
        record: async () => undefined,
        clear: async () => undefined,
        clearAll: async () => undefined,
        load: async () => [],
      },
      snapshotFetcher: { fetchCurrentSnapshot: async () => null },
    });
    const body = await call(composition.gate);
    assertPinnedShape(body);
    expect(body.meter).toEqual({ count: null, degraded: true }); // §7/C5 posture
    expect(body.coverage.degraded).toBe(false);
    expect(body.coverage.allowedLocationIds).toEqual(['loc-default']);
  });
});
