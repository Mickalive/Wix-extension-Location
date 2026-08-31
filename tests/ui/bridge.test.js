/**
 * services bridge — typed error model.
 *
 * Repair regression (F-N5): a malformed 2xx body maps to a typed
 * BridgeError('BAD_RESPONSE'), never a raw SyntaxError. Also covered:
 * BRIDGE_NOT_CONFIGURED offline, 404 -> null semantics, HTTP_<status>,
 * TRANSPORT_FAILURE, and the apply-plan payload shape (confirmed hash only).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createServicesBridge,
  BridgeError,
  isBridgeError,
} from '../../src/ui/services/bridge.js';

function okResponse(body) {
  return { status: 200, text: async () => JSON.stringify(body) };
}

test('successful GET parses the JSON body', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => okResponse({ ruleSetId: 'r1' }),
  });
  assert.deepEqual(await bridge.getActiveRuleSet(), { ruleSetId: 'r1' });
});

test('404 maps to null (no active rule set), not an error', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => ({ status: 404, text: async () => '' }),
  });
  assert.equal(await bridge.getActiveRuleSet(), null);
});

test('non-2xx responses map to typed HTTP_<status> errors', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => ({ status: 500, text: async () => 'boom' }),
  });
  await assert.rejects(bridge.saveRuleSet({}), (error) => {
    assert.ok(isBridgeError(error));
    assert.equal(error.code, 'HTTP_500');
    assert.equal(error.status, 500);
    return true;
  });
});

test('transport rejection maps to TRANSPORT_FAILURE', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => {
      throw new Error('socket hang up');
    },
  });
  await assert.rejects(bridge.getActiveRuleSet(), (error) => {
    assert.equal(error.code, 'TRANSPORT_FAILURE');
    return true;
  });
});

test('F-N5: malformed 2xx JSON body maps to typed BAD_RESPONSE', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => ({
      status: 200,
      text: async () => '<html>not json</html>',
    }),
  });
  await assert.rejects(bridge.getActiveRuleSet(), (error) => {
    assert.ok(isBridgeError(error), 'must be a BridgeError, not SyntaxError');
    assert.equal(error.code, 'BAD_RESPONSE');
    assert.equal(error.name, 'BridgeError');
    assert.equal(error.status, 200);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('F-N5: empty 2xx body resolves to null without throwing', async () => {
  const bridge = createServicesBridge({
    transportLoader: async () => async () => ({ status: 204, text: async () => '' }),
  });
  assert.equal(await bridge.request('/anything'), null);
});

test('unresolvable transport maps to BRIDGE_NOT_CONFIGURED (offline safety)', async () => {
  const bridge = createServicesBridge({
    // Simulates Node/offline where the Wix runtime module cannot resolve.
    transportLoader: async () => {
      throw new Error("Cannot find module '@wix/essentials'");
    },
  });
  await assert.rejects(bridge.getActiveRuleSet(), (error) => {
    assert.equal(error.code, 'BRIDGE_NOT_CONFIGURED');
    return true;
  });
});

test('a healthy first transport is cached; later loader failures do not matter', async () => {
  let calls = 0;
  const bridge = createServicesBridge({
    transportLoader: async () => {
      calls += 1;
      if (calls === 1) return async () => okResponse({ ok: true });
      throw new Error('should not be called again');
    },
  });
  await bridge.getActiveRuleSet();
  await bridge.getActiveRuleSet();
  assert.equal(calls, 1);
});

test('requestApply posts only the confirmed diff hash (no ops)', async () => {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ path, method: init.method, body: JSON.parse(init.body) });
        return okResponse({ accepted: true });
      },
  });
  const result = await bridge.requestApply('abc12345');
  assert.deepEqual(result, { accepted: true });
  assert.equal(seen[0].path, '/api/rules/apply-plan');
  assert.equal(seen[0].method, 'POST');
  assert.deepEqual(Object.keys(seen[0].body).sort(), ['confirmedDiffHash']);
  assert.equal(seen[0].body.confirmedDiffHash, 'abc12345');
});

test('requestApply body matches the platform postApplyPlan schema exactly', async () => {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ body: JSON.parse(init.body) });
        return okResponse({ summary: { planId: 'p1' }, requestedBy: 'user-1' });
      },
  });
  await bridge.requestApply('hash-42');
  const body = seen[0].body;
  // Regression: the platform endpoint rejects any key beyond confirmedDiffHash
  // (mutationEndpoints.ts postApplyPlan checks unexpectedKeys). The bridge
  // must never send ops, plan, or any other field.
  assert.equal(typeof body, 'object', 'body must be an object');
  assert.equal(Array.isArray(body), false, 'body must not be an array');
  const keys = Object.keys(body);
  assert.equal(keys.length, 1, 'body must have exactly one key');
  assert.equal(keys[0], 'confirmedDiffHash', 'the only accepted key is confirmedDiffHash');
  assert.equal(typeof body.confirmedDiffHash, 'string', 'confirmedDiffHash must be a string');
  assert.ok(body.confirmedDiffHash.length > 0, 'confirmedDiffHash must not be empty');
});

test('saveRuleSet PUTs the draft to the ruleset endpoint', async () => {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ path, method: init.method });
        return okResponse({ saved: true });
      },
  });
  await bridge.saveRuleSet({ ruleSetId: 'draft-1' });
  assert.equal(seen[0].path, '/api/rules/ruleset');
  assert.equal(seen[0].method, 'PUT');
});

test('BridgeError identity helpers', () => {
  const error = new BridgeError('HTTP_418', 'teapot', { status: 418 });
  assert.ok(isBridgeError(error));
  assert.equal(isBridgeError(new Error('nope')), false);
});
