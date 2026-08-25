/**
 * services bridge — typed error model.
 *
 * Repair regression (F-N5): a malformed 2xx body maps to a typed
 * BridgeError('BAD_RESPONSE'), never a raw SyntaxError. Also covered:
 * BRIDGE_NOT_CONFIGURED offline, 404 -> null semantics, HTTP_<status>,
 * TRANSPORT_FAILURE, and the apply-plan payload shape (ops + confirmed hash).
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

test('requestApply posts ops plus the confirmed diff hash', async () => {
  const seen = [];
  const bridge = createServicesBridge({
    transportLoader: async () =>
      async (path, init) => {
        seen.push({ path, method: init.method, body: JSON.parse(init.body) });
        return okResponse({ accepted: true });
      },
  });
  const result = await bridge.requestApply([{ kind: 'ADD_WINDOW', start: '09:00' }], 'abc12345');
  assert.deepEqual(result, { accepted: true });
  assert.equal(seen[0].path, '/api/rules/apply-plan');
  assert.equal(seen[0].method, 'POST');
  assert.deepEqual(seen[0].body.ops, [{ kind: 'ADD_WINDOW', start: '09:00' }]);
  assert.equal(seen[0].body.confirmedDiffHash, 'abc12345');
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
