/**
 * Recovery-guidance honesty regressions (DASH-C4-1b/d; audit findings N-A and
 * N-B of reports/audits/CYCLE_32792897988_DASHBOARD.md section 6).
 *
 * N-A: the failed-state guidance may mention "Recover interrupted apply" ONLY
 * when state.lastMutation?.scope is known — the affordance cannot render
 * without a ScheduleScope, so mentioning it otherwise is unfollowable.
 * Covered states: first-probe failure, all-null probes (EXHAUSTED), and a
 * scope-less FAILED_TERMINAL projection — each with a scoped control proving
 * the sentence still appears when a scope WAS observed.
 *
 * N-B: same-tick synthetic multi-click on the recover control collapses into
 * exactly one bridge.recover call (trivial synchronous in-flight guard).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRulesEditorPage } from '../../src/ui/pages/rulesEditorPage.js';
import { createEditorStore } from '../../src/ui/state/editorStore.js';
import { BridgeError } from '../../src/ui/services/bridge.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, maybeByTestId } from './helpers/dom.js';

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

/** Confirmed-page harness (same shape as tests/ui/applyFlow.test.js). */
function setupConfirmedPage({ statuses = [], recoverImpl } = {}) {
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
      return { summary: { planId: 'plan-1' } };
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

  byTestId(doc.body, 'review-changes').click();
  byTestId(doc.body, 'confirm-diff').click();

  return { doc, store, page, calls };
}

function statusText(doc) {
  return byTestId(doc.body, 'action-status').textContent;
}

// ------------------------------------------------------------------- N-A

test('N-A: first-probe failure never mentions Recover (no scope was ever observed)', async () => {
  const { doc, store } = setupConfirmedPage({
    statuses: [new BridgeError('TRANSPORT_FAILURE', 'connection lost')],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.equal(store.getState().lastMutation, null, 'no scope tracked');
  assert.match(statusText(doc), /It is not known whether the change set completed/);
  assert.doesNotMatch(statusText(doc), /Recover interrupted apply/, 'guidance must stay followable');
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
});

test('N-A: all-null probes exhaust without a Recover mention (scope never arrived)', async () => {
  const { doc, store, calls } = setupConfirmedPage({
    statuses: [null, null, null],
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.equal(store.getState().lastMutation, null, 'null observations carry no scope');
  // The harness pads remaining probes with nulls up to the poll bound (6).
  assert.match(statusText(doc), /could not be confirmed after 6 checks/);
  assert.match(statusText(doc), /Check back later/);
  assert.doesNotMatch(statusText(doc), /Recover interrupted apply/, 'guidance must stay followable');
  assert.equal(maybeByTestId(doc.body, 'recover-interrupted'), null);
  assert.equal(calls.getMutationStatus.length, 6);
});

test('N-A control: exhausted WITH an observed scope still offers Recover guidance', async () => {
  const { doc, store } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  assert.equal(store.getState().applyStatus, 'failed');
  assert.deepEqual(store.getState().lastMutation.scope, SCOPE);
  assert.match(statusText(doc), /Recover interrupted apply/);
  assert.ok(byTestId(doc.body, 'recover-interrupted'));
});

test('N-A: scope-less FAILED_TERMINAL projection omits the recovery sentence; scoped one keeps it', async () => {
  const scopeless = setupConfirmedPage({ statuses: [projection('SOME_FUTURE_STATE', false)] });
  byTestId(scopeless.doc.body, 'apply-changes').click();
  await flush();
  assert.equal(scopeless.store.getState().applyStatus, 'failed');
  assert.match(statusText(scopeless.doc), /unresolved state \(SOME_FUTURE_STATE\)/);
  assert.doesNotMatch(statusText(scopeless.doc), /Recover interrupted apply/);
  assert.equal(maybeByTestId(scopeless.doc.body, 'recover-interrupted'), null);

  const scoped = setupConfirmedPage({ statuses: [projection('SOME_FUTURE_STATE', true)] });
  byTestId(scoped.doc.body, 'apply-changes').click();
  await flush();
  assert.match(statusText(scoped.doc), /Use “Recover interrupted apply” to restore your schedules/);
  assert.ok(byTestId(scoped.doc.body, 'recover-interrupted'));
});

// ------------------------------------------------------------------- N-B

test('N-B: same-tick triple click on Recover fires exactly one bridge call', async () => {
  let recoverCalls = 0;
  const { doc } = setupConfirmedPage({
    statuses: Array.from({ length: 20 }, () => projection('APPLY_IN_PROGRESS')),
    recoverImpl: () => {
      recoverCalls += 1;
      return null;
    },
  });
  byTestId(doc.body, 'apply-changes').click();
  await flush();

  const recoverButton = byTestId(doc.body, 'recover-interrupted');
  // Three synchronous clicks land before any disabled re-render can.
  recoverButton.click();
  recoverButton.click();
  recoverButton.click();
  await flush();

  assert.equal(recoverCalls, 1, 'in-flight guard collapses same-tick multi-clicks');
});
