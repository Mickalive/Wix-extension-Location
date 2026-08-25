/**
 * Apply-flow mutation lifecycle over the rendered page (DASH-C3-1b/c).
 *
 * Proves the Blueprint §4 flow-3 surface end to end:
 *   - after requestApply, the page polls getMutationStatus until a TERMINAL
 *     journal state and renders that outcome ONCE in the role="status"
 *     region (applied / rolled back / failed with guidance);
 *   - polling is bounded and stops permanently after terminal or error;
 *   - recovery exists ONLY as an explicit button: rendering, polling and
 *     waiting never call bridge.recover; a click calls it exactly once with
 *     the tracked scope; clicking recover never re-applies anything;
 *   - no path auto-applies or auto-retries a destructive operation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRulesEditorPage } from '../../src/ui/pages/rulesEditorPage.js';
import { createEditorStore } from '../../src/ui/state/editorStore.js';
import { BridgeError } from '../../src/ui/services/bridge.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, maybeByTestId, allByTestId } from './helpers/dom.js';

const SCOPE = { scheduleId: 'sch-1', ownerType: 'BUSINESS', ownerId: 'owner-1' };

function projection(state, withScope = true) {
  return {
    planId: 'plan-1',
    state,
    scope: withScope ? SCOPE : null,
    confirmedChangeIds: [],
    totalChanges: 1,
    updatedAt: '2026-08-25T10:00:00.000Z',
    snapshotId: 'snap-1',
  };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Full harness: valid draft -> reviewed -> confirmed, so "Apply to schedules"
 * is enabled. The fake bridge records every call; status probes are scripted.
 */
function setupConfirmedPage({ statuses = [], applyResponse = { summary: { planId: 'plan-1' } }, recoverImpl } = {}) {
  const doc = createDocument();
  const locations = [{ id: 'l1', label: 'Downtown' }];
  const services = [{ id: 's1', label: 'Consultation' }];
  const store = createEditorStore({ savedRuleSet: null, locations, services });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '09:00', end: '12:00' },
  });

  const calls = { requestApply: [], getMutationStatus: [], recover: [] };
  const script = [...statuses];
  const bridge = {
    async saveRuleSet(draft) {
      return draft;
    },
    async requestApply(ops, confirmedHash) {
      calls.requestApply.push({ ops, confirmedHash });
      return typeof applyResponse === 'function' ? applyResponse() : applyResponse;
    },
    async getMutationStatus(planId) {
      calls.getMutationStatus.push(planId);
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    async recover(scope) {
      calls.recover.push(scope);
      return recoverImpl ? recoverImpl(scope) : null;
    },
  };

  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge,
    locations,
    services,
    pollOptions: { maxAttempts: 6, delayMs: 0, delayFn: async () => {} },
  });
  doc.body.appendChild(page.root);

  // Review + confirm through the real UI path.
  byTestId(doc.body, 'review-changes').click();
  byTestId(doc.body, 'confirm-diff').click();

  return { doc, store, page, calls, bridge };
}

test('apply polls to APPLY_COMPLETED and renders the applied outcome once', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    statuses: [projection('APPLY_IN_PROGRESS'), projection('APPLY_COMPLETED')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'applied');
  const statusText = byTestId(doc.body, 'action-status').textContent;
  assert.equal(statusText.split('Schedule changes applied.').length - 1, 1, 'outcome rendered exactly once');
  assert.equal(calls.getMutationStatus.length, 2);
  assert.equal(calls.getMutationStatus[0], 'plan-1');
  // Clean terminal: no recover affordance lingers.
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
});

test('immediate terminal state: single probe, single render, polling stops for good', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    statuses: [projection('APPLY_COMPLETED')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();
  assert.equal(store.getState().applyStatus, 'applied');
  assert.equal(calls.getMutationStatus.length, 1);
  // Extra event-loop turns must NOT produce more probes or duplicate renders.
  await flush(8);
  assert.equal(calls.getMutationStatus.length, 1);
  assert.equal(byTestId(doc.body, 'action-status').textContent.split('Schedule changes applied.').length - 1, 1);
});

test('ROLLED_BACK terminal renders rollback guidance and consumes consent', async () => {
  const { doc, store } = setupConfirmedPage({
    statuses: [projection('ROLLED_BACK')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'rolled_back');
  assert.match(byTestId(doc.body, 'action-status').textContent, /rolled back to their previous state/);
  // One consent = one attempt: confirmation cleared, apply locked again.
  assert.equal(store.getState().confirmedHash, null);
  assert.equal(store.canApply(), false);
  assert.equal(byTestId(doc.body, 'apply-changes').disabled, true);
  // Clean terminal: no recover control.
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
});

test('bounded polling: always-non-terminal journal stops at the bound with failed guidance + recover affordance', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.match(byTestId(doc.body, 'action-status').textContent, /could not be confirmed after 6 checks/);
  assert.match(byTestId(doc.body, 'action-status').textContent, /Recover interrupted apply/);
  assert.equal(calls.getMutationStatus.length, 6, 'hard bound respected (no infinite loop)');
  // The scope observed during polling is tracked for explicit recovery.
  assert.deepEqual(store.getState().lastMutation.scope, SCOPE);
  const recoverButton = byTestId(doc.body, 'recover-interrupted');
  assert.equal(recoverButton.disabled, false);
});

test('mid-poll bridge error stops polling permanently and offers explicit recovery', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    statuses: [projection('SNAPSHOT_PERSISTED'), new BridgeError('TRANSPORT_FAILURE', 'connection lost')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.match(byTestId(doc.body, 'action-status').textContent, /network problem/);
  assert.match(byTestId(doc.body, 'action-status').textContent, /It is not known whether the change set completed/);
  assert.equal(calls.getMutationStatus.length, 2, 'stops at the failing attempt');
  // Permanent stop: further event-loop turns never resume polling.
  await flush(8);
  assert.equal(calls.getMutationStatus.length, 2);
  assert.ok(byTestId(doc.body, 'recover-interrupted'));
});

test('recovery fires ONLY on explicit click, exactly once, with the tracked scope — never auto', async () => {
  const { doc, calls } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
    recoverImpl: () => ({
      planId: 'plan-1',
      snapshotId: 'snap-1',
      complete: true,
      mismatches: [],
      notes: ['restored 1 MASTER'],
      auditEntryId: 'audit-9',
    }),
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  // No auto-recovery while merely rendering/waiting:
  assert.equal(calls.recover.length, 0);

  // Explicit click #1: exactly one recover call carrying the tracked scope.
  byTestId(doc.body, 'recover-interrupted').click();
  await flush();
  assert.equal(calls.recover.length, 1);
  assert.deepEqual(calls.recover[0], SCOPE);

  // Recovery outcome rendered from the typed RecoverySummary.
  assert.match(byTestId(doc.body, 'action-status').textContent, /Recovery completed/);
  assert.match(byTestId(doc.body, 'recovery-summary').textContent, /audit-9/);
  assert.deepEqual(
    allByTestId(doc.body, 'recovery-note').map((n) => n.textContent),
    ['restored 1 MASTER'],
  );

  // The destructive apply is NEVER retried by recovery: still exactly one apply.
  assert.equal(calls.requestApply.length, 1);
});

test('keyboard activation of the recover control works (Enter), still click-only', async () => {
  const { doc, calls } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
    recoverImpl: () => null,
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  byTestId(doc.body, 'recover-interrupted').press('Enter');
  await flush();
  assert.equal(calls.recover.length, 1);
  // {recovery: null} renders the honest nothing-pending line.
  assert.match(byTestId(doc.body, 'action-status').textContent, /Nothing was pending for this schedule/);
});

test('incomplete recovery renders mismatches verbatim instead of pretending success', async () => {
  const { doc } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
    recoverImpl: () => ({
      planId: 'plan-1',
      snapshotId: 'snap-1',
      complete: false,
      mismatches: ['MON MASTER drifted: 09:00-12:00 vs expected 08:00-11:00'],
      notes: ['second restore attempt queued'],
      auditEntryId: 'audit-10',
    }),
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();
  byTestId(doc.body, 'recover-interrupted').click();
  await flush();

  assert.match(byTestId(doc.body, 'action-status').textContent, /unresolved items/);
  assert.deepEqual(
    allByTestId(doc.body, 'recovery-mismatch').map((n) => n.textContent),
    ['MON MASTER drifted: 09:00-12:00 vs expected 08:00-11:00'],
  );
});

test('no recover affordance when no scope was ever observed (nothing fabricable)', async () => {
  const { doc, store } = setupConfirmedPage({
    // Missing planId in the response: honest failure without any tracking.
    applyResponse: { summary: {} },
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.match(byTestId(doc.body, 'action-status').textContent, /did not include a change-set reference/);
  assert.equal(store.getState().lastMutation, null);
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
});

test('unknown failed-terminal journal state renders its raw state with guidance', async () => {
  const { doc, store } = setupConfirmedPage({
    statuses: [projection('SOME_FUTURE_STATE')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.match(byTestId(doc.body, 'action-status').textContent, /unresolved state \(SOME_FUTURE_STATE\)/);
  assert.ok(byTestId(doc.body, 'recover-interrupted'), 'explicit recovery offered');
});

test('recover affordance stays hidden while an apply poll is still in flight (no concurrent recovery)', async () => {
  const doc = createDocument();
  const locations = [{ id: 'l1', label: 'Downtown' }];
  const services = [{ id: 's1', label: 'Consultation' }];
  const store = createEditorStore({ savedRuleSet: null, locations, services });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '09:00', end: '12:00' },
  });

  const calls = { getMutationStatus: 0, recover: 0 };
  let releaseSecondProbe;
  const secondProbeGate = new Promise((resolve) => {
    releaseSecondProbe = resolve;
  });
  const bridge = {
    async saveRuleSet(draft) {
      return draft;
    },
    async requestApply() {
      return { summary: { planId: 'plan-1' } };
    },
    async getMutationStatus() {
      calls.getMutationStatus += 1;
      if (calls.getMutationStatus === 1) return projection('APPLY_IN_PROGRESS');
      await secondProbeGate;
      return projection('APPLY_COMPLETED');
    },
    async recover() {
      calls.recover += 1;
      return null;
    },
  };
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge,
    locations,
    services,
    pollOptions: { maxAttempts: 6, delayMs: 0, delayFn: async () => {} },
  });
  doc.body.appendChild(page.root);
  byTestId(doc.body, 'review-changes').click();
  byTestId(doc.body, 'confirm-diff').click();

  byTestId(doc.body, 'apply-changes').click();
  // Let the first (non-terminal) observation land: scope tracked, apply
  // still pending on the second probe.
  await flush();
  assert.equal(store.getState().applyStatus, 'pending');
  assert.deepEqual(store.getState().lastMutation.scope, SCOPE);
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null, 'no recovery UI during a live apply');
  assert.equal(calls.recover, 0);

  // Resolve the poll to its terminal state; clean terminal keeps it hidden.
  releaseSecondProbe();
  await flush();
  assert.equal(store.getState().applyStatus, 'applied');
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
  page.destroy();
});

test('requestApply transport failure keeps the pre-existing unavailable semantics', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    applyResponse: () => {
      throw new BridgeError('TRANSPORT_FAILURE', 'no response arrived');
    },
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'unavailable');
  assert.match(byTestId(doc.body, 'action-status').textContent, /network problem/);
  assert.equal(calls.getMutationStatus.length, 0, 'no polling without an accepted plan reference');
});
