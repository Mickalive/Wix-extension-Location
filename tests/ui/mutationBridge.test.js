/**
 * services bridge — mutation-lifecycle client methods (DASH-C3-1a).
 *
 * Proves getMutationStatus/recover map the accepted platform DTOs
 * (`src/platform/http/mutationEndpoints.ts`) onto the SAME typed BridgeError
 * taxonomy as the rest of the bridge:
 *   - transport failures        -> TRANSPORT_FAILURE
 *   - non-2xx                   -> HTTP_<status>
 *   - malformed JSON            -> BAD_RESPONSE (cause preserved)
 *   - empty/envelope-less 2xx   -> BAD_RESPONSE (strict: these endpoints have
 *                                  mandatory envelopes; an empty success body
 *                                  must never be read as "no record")
 *   - 404                       -> null (documented NOT_FOUND semantics)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createServicesBridge,
  isBridgeError,
} from '../../src/ui/services/bridge.js';

const PROJECTION = {
  planId: 'plan-1',
  state: 'APPLY_IN_PROGRESS',
  scope: { scheduleId: 'sch-1', ownerType: 'BUSINESS', ownerId: 'owner-1', locationId: null },
  confirmedChangeIds: ['c-mon-am'],
  totalChanges: 2,
  updatedAt: '2026-08-25T10:00:00.000Z',
  snapshotId: 'snap-1',
};

const RECOVERY = {
  planId: 'plan-1',
  snapshotId: 'snap-1',
  complete: true,
  mismatches: [],
  notes: ['restored 2 MASTER events'],
  auditEntryId: 'audit-1',
};

function okResponse(body) {
  return { status: 200, text: async () => JSON.stringify(body) };
}

function bridgeWith(responder) {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
        return responder(seen.length);
      },
  });
  return { bridge, seen };
}

// ------------------------------------------------------- getMutationStatus

test('getMutationStatus GETs the mutation-status endpoint and unwraps the {status} projection', async () => {
  const { bridge, seen } = bridgeWith(() => okResponse({ status: PROJECTION }));
  const result = await bridge.getMutationStatus('plan-1');
  assert.deepEqual(result, PROJECTION);
  assert.equal(seen[0].path, '/api/rules/mutation-status?planId=plan-1');
  assert.equal(seen[0].method, 'GET');
});

test('getMutationStatus URL-encodes the planId query parameter', async () => {
  const { bridge, seen } = bridgeWith(() => okResponse({ status: PROJECTION }));
  await bridge.getMutationStatus('plan 1/x?y');
  assert.equal(seen[0].path, '/api/rules/mutation-status?planId=plan%201%2Fx%3Fy');
});

test('getMutationStatus maps 404 (no journal record) to null', async () => {
  const { bridge } = bridgeWith(() => ({ status: 404, text: async () => '' }));
  assert.equal(await bridge.getMutationStatus('unknown-plan'), null);
});

test('getMutationStatus maps non-2xx to typed HTTP_<status>', async () => {
  const { bridge } = bridgeWith(() => ({ status: 500, text: async () => 'boom' }));
  await assert.rejects(bridge.getMutationStatus('plan-1'), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'HTTP_500');
    assert.equal(error.status, 500);
    return true;
  });
});

test('getMutationStatus maps transport rejection to TRANSPORT_FAILURE', async () => {
  const { bridge } = bridgeWith(() => {
    throw new Error('socket hang up');
  });
  await assert.rejects(bridge.getMutationStatus('plan-1'), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'TRANSPORT_FAILURE');
    return true;
  });
});

test('getMutationStatus maps malformed 2xx JSON to typed BAD_RESPONSE (never raw SyntaxError)', async () => {
  const { bridge } = bridgeWith(() => ({ status: 200, text: async () => '<html/>not json' }));
  await assert.rejects(bridge.getMutationStatus('plan-1'), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('getMutationStatus treats an empty 2xx body as BAD_RESPONSE (mandatory envelope)', async () => {
  const { bridge } = bridgeWith(() => ({ status: 200, text: async () => '' }));
  await assert.rejects(bridge.getMutationStatus('plan-1'), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.match(error.message, /empty 2xx body/);
    return true;
  });
});

test('getMutationStatus rejects a 2xx body without the {status} envelope', async () => {
  const { bridge } = bridgeWith(() => okResponse({ foo: 'bar' }));
  await assert.rejects(bridge.getMutationStatus('plan-1'), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.match(error.message, /"status" envelope/);
    return true;
  });
});

// ---------------------------------------------------------------- recover

test('recover POSTs {scope} to the recover endpoint and unwraps the RecoverySummary', async () => {
  const { bridge, seen } = bridgeWith(() => okResponse({ recovery: RECOVERY }));
  const scope = { scheduleId: 'sch-1', ownerType: 'BUSINESS', ownerId: 'owner-1' };
  const result = await bridge.recover(scope);
  assert.deepEqual(result, RECOVERY);
  assert.equal(seen[0].path, '/api/rules/recover');
  assert.equal(seen[0].method, 'POST');
  assert.deepEqual(seen[0].body, { scope });
});

test('recover returns null for the documented {recovery: null} nothing-pending response', async () => {
  const { bridge } = bridgeWith(() => okResponse({ recovery: null }));
  assert.equal(
    await bridge.recover({ scheduleId: 'sch-1', ownerType: 'STAFF', ownerId: 'own-9' }),
    null,
  );
});

test('recover maps non-2xx to typed HTTP_<status>', async () => {
  const { bridge } = bridgeWith(() => ({ status: 400, text: async () => '{"error":{}}' }));
  await assert.rejects(bridge.recover({}), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'HTTP_400');
    assert.equal(error.status, 400);
    return true;
  });
});

test('recover maps transport rejection to TRANSPORT_FAILURE', async () => {
  const { bridge } = bridgeWith(() => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(bridge.recover({ scheduleId: 's' }), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'TRANSPORT_FAILURE');
    return true;
  });
});

test('recover maps malformed 2xx JSON to typed BAD_RESPONSE', async () => {
  const { bridge } = bridgeWith(() => ({ status: 200, text: async () => 'not-json{' }));
  await assert.rejects(bridge.recover({ scheduleId: 's' }), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('recover treats an empty 2xx body as BAD_RESPONSE (mandatory envelope)', async () => {
  const { bridge } = bridgeWith(() => ({ status: 204, text: async () => '' }));
  await assert.rejects(bridge.recover({ scheduleId: 's' }), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
});

test('recover rejects a 2xx body without the {recovery} envelope', async () => {
  const { bridge } = bridgeWith(() => okResponse({ done: true }));
  await assert.rejects(bridge.recover({ scheduleId: 's' }), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.match(error.message, /"recovery" envelope/);
    return true;
  });
});
