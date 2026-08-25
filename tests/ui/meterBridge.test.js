/**
 * services bridge — entitlement meter client method (DASH-C4-1a).
 *
 * Pins getEntitlementMeter() to the cross-lane GET /meter DTO EXACTLY as
 * pinned in INT-C4-1(c) and docs/NEXT_CYCLE.json
 * (cross_lane_compatibility.pinned_dto_get_meter):
 *
 *   { meter:    { count: number|null, degraded: boolean },
 *     coverage: { allowedLocationIds: string[], overLimit: boolean,
 *                 degraded: boolean, warning: string|null } }
 *
 * Error taxonomy is identical to every other bridge method:
 *   - transport failures            -> TRANSPORT_FAILURE
 *   - non-2xx                       -> HTTP_<status> (incl. 401 unauthorized)
 *   - malformed JSON                -> BAD_RESPONSE (cause preserved)
 *   - empty 2xx body                -> BAD_RESPONSE (a meter always has a body)
 *   - drifted/shapeless 2xx bodies  -> BAD_RESPONSE (never render invented
 *                                      entitlement state)
 *   - 404                           -> null (documented n/a semantics)
 *
 * Until INT-C4-1 lands these tests fixture against the pinned shape — the
 * same DTO-pinning pattern the mutation-lifecycle tests used in cycle 3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createServicesBridge,
  isBridgeError,
} from '../../src/ui/services/bridge.js';

/** Verbatim copy of the pinned DTO from docs/NEXT_CYCLE.json (INT-C4-1c). */
const PINNED_METER_DTO = {
  meter: { count: 3, degraded: false },
  coverage: {
    allowedLocationIds: ['loc-default-1', 'loc-a', 'loc-b'],
    overLimit: false,
    degraded: false,
    warning: null,
  },
};

function okResponse(body) {
  return { status: 200, text: async () => JSON.stringify(body) };
}

function bridgeWith(responder) {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ path, method: init.method });
        return responder(seen.length);
      },
  });
  return { bridge, seen };
}

// ------------------------------------------------------------- happy paths

test('getEntitlementMeter GETs /meter and returns the pinned DTO verbatim', async () => {
  const { bridge, seen } = bridgeWith(() => okResponse(PINNED_METER_DTO));
  const result = await bridge.getEntitlementMeter();
  assert.deepEqual(result, PINNED_METER_DTO);
  assert.equal(seen[0].path, '/api/rules/meter');
  assert.equal(seen[0].method, 'GET');
});

test('getEntitlementMeter passes through a fully degraded reading (count null + coverage degraded)', async () => {
  const degraded = {
    meter: { count: null, degraded: true },
    coverage: {
      allowedLocationIds: [],
      overLimit: false,
      degraded: true,
      warning: 'Location listing unavailable — entitlement coverage temporarily unknown.',
    },
  };
  const { bridge } = bridgeWith(() => okResponse(degraded));
  assert.deepEqual(await bridge.getEntitlementMeter(), degraded);
});

test('getEntitlementMeter passes through over-limit coverage with an operator warning', async () => {
  const overLimit = {
    meter: { count: 5, degraded: false },
    coverage: {
      allowedLocationIds: ['loc-1', 'loc-2'],
      overLimit: true,
      degraded: false,
      warning: 'Paid subscription recognized with an unmapped plan identifier.',
    },
  };
  const { bridge } = bridgeWith(() => okResponse(overLimit));
  assert.deepEqual(await bridge.getEntitlementMeter(), overLimit);
});

// ------------------------------------------------------------ status codes

test('getEntitlementMeter maps 404 (no usage information) to null', async () => {
  const { bridge } = bridgeWith(() => ({ status: 404, text: async () => '' }));
  assert.equal(await bridge.getEntitlementMeter(), null);
});

test('getEntitlementMeter maps non-2xx to typed HTTP_<status>', async () => {
  const { bridge } = bridgeWith(() => ({ status: 500, text: async () => 'boom' }));
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'HTTP_500');
    assert.equal(error.status, 500);
    return true;
  });
});

test('getEntitlementMeter maps 401 (unauthenticated caller) to typed HTTP_401', async () => {
  const { bridge } = bridgeWith(() => ({ status: 401, text: async () => '{"error":"unauthorized"}' }));
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'HTTP_401');
    assert.equal(error.status, 401);
    return true;
  });
});

test('getEntitlementMeter maps transport rejection to TRANSPORT_FAILURE', async () => {
  const { bridge } = bridgeWith(() => {
    throw new Error('socket hang up');
  });
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'TRANSPORT_FAILURE');
    return true;
  });
});

// ------------------------------------------------------- body strictness

test('getEntitlementMeter maps malformed 2xx JSON to typed BAD_RESPONSE (never raw SyntaxError)', async () => {
  const { bridge } = bridgeWith(() => ({ status: 200, text: async () => '<html/>not json' }));
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('getEntitlementMeter treats an empty 2xx body as BAD_RESPONSE', async () => {
  const { bridge } = bridgeWith(() => ({ status: 200, text: async () => '   ' }));
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.match(error.message, /empty 2xx body/);
    return true;
  });
});

test('getEntitlementMeter rejects a 2xx body missing the meter key', async () => {
  const { bridge } = bridgeWith(() =>
    okResponse({ coverage: PINNED_METER_DTO.coverage }),
  );
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.match(error.message, /pinned entitlement meter DTO/);
    return true;
  });
});

test('getEntitlementMeter rejects a 2xx body missing the coverage key', async () => {
  const { bridge } = bridgeWith(() => okResponse({ meter: PINNED_METER_DTO.meter }));
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
});

test('getEntitlementMeter rejects wrong-typed meter fields (count string, degraded missing)', async () => {
  for (const meter of [{ count: '3', degraded: false }, { count: null }]) {
    const { bridge } = bridgeWith(() => okResponse({ meter, coverage: PINNED_METER_DTO.coverage }));
    await assert.rejects(bridge.getEntitlementMeter(), (error) => {
      assert.ok(isBridgeError(error));
      assert.equal(error.code, 'BAD_RESPONSE');
      return true;
    });
  }
});

test('getEntitlementMeter rejects non-string entries in allowedLocationIds', async () => {
  const { bridge } = bridgeWith(() =>
    okResponse({
      meter: PINNED_METER_DTO.meter,
      coverage: {
        allowedLocationIds: ['loc-1', 42],
        overLimit: false,
        degraded: false,
        warning: null,
      },
    }),
  );
  await assert.rejects(bridge.getEntitlementMeter(), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
});

test('getEntitlementMeter rejects wrong-typed coverage scalars (warning number, overLimit string)', async () => {
  for (const patch of [{ warning: 7 }, { overLimit: 'no' }, { degraded: null }]) {
    const { bridge } = bridgeWith(() =>
      okResponse({ meter: PINNED_METER_DTO.meter, coverage: { ...PINNED_METER_DTO.coverage, ...patch } }),
    );
    await assert.rejects(bridge.getEntitlementMeter(), (error) => {
      assert.ok(isBridgeError(error));
      assert.equal(error.code, 'BAD_RESPONSE');
      return true;
    });
  }
});

test('getEntitlementMeter rejects array or null bodies', async () => {
  for (const responder of [() => okResponse([]), () => okResponse(null)]) {
    const { bridge } = bridgeWith(responder);
    await assert.rejects(bridge.getEntitlementMeter(), (error) => {
      assert.ok(isBridgeError(error));
      assert.equal(error.code, 'BAD_RESPONSE');
      return true;
    });
  }
});

test('getEntitlementMeter tolerates additive extra fields on the pinned shape', async () => {
  const extended = {
    meter: { ...PINNED_METER_DTO.meter, futureField: 'x' },
    coverage: { ...PINNED_METER_DTO.coverage, anotherFutureField: 1 },
    topLevelExtra: true,
  };
  const { bridge } = bridgeWith(() => okResponse(extended));
  assert.deepEqual(await bridge.getEntitlementMeter(), extended);
});
