/**
 * Poller observer-fault containment (DASH-C4-1c; audit finding N-C of
 * reports/audits/CYCLE_32792897988_DASHBOARD.md section 6).
 *
 * Regression: an exception thrown from onObservation must be wrapped into an
 * ERROR outcome instead of propagating, and polling must stop permanently —
 * including when the throw happens on the observation that would have been
 * terminal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { pollMutationUntilTerminal } from '../../src/ui/state/mutationPoller.js';

const SCOPE = { scheduleId: 'sch-1', ownerType: 'BUSINESS', ownerId: 'owner-1' };

function projection(state) {
  return {
    planId: 'plan-1',
    state,
    scope: SCOPE,
    confirmedChangeIds: [],
    totalChanges: 1,
    updatedAt: '2026-08-25T10:00:00.000Z',
    snapshotId: 'snap-1',
  };
}

const IMMEDIATE = async () => {};

function countingStatus(script) {
  let calls = 0;
  const getStatus = async () => {
    calls += 1;
    const next = script.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  return { getStatus, count: () => calls };
}

async function churn(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('N-C: a throwing observer yields an ERROR outcome and stops polling', async () => {
  const boom = new Error('observer exploded');
  const { getStatus, count } = countingStatus([
    projection('SNAPSHOT_PERSISTED'),
    projection('APPLY_IN_PROGRESS'),
  ]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 8,
    delayMs: 0,
    delayFn: IMMEDIATE,
    onObservation: () => {
      throw boom;
    },
  });

  assert.equal(outcome.kind, 'ERROR');
  assert.equal(outcome.error, boom);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.lastState, 'SNAPSHOT_PERSISTED');
  assert.equal(count(), 1, 'polling stopped at the throwing attempt');
  await churn();
  assert.equal(count(), 1, 'nothing resumes the loop afterwards');
});

test('N-C: an observer throwing on the TERMINAL observation still yields ERROR, never APPLIED', async () => {
  const boom = new Error('observer exploded at terminal');
  const { getStatus, count } = countingStatus([projection('APPLY_COMPLETED')]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 8,
    delayMs: 0,
    delayFn: IMMEDIATE,
    onObservation: () => {
      throw boom;
    },
  });

  assert.equal(outcome.kind, 'ERROR');
  assert.equal(outcome.error, boom);
  assert.equal(outcome.state, undefined, 'terminal classification never reached');
  assert.equal(outcome.lastState, 'APPLY_COMPLETED');
  assert.equal(count(), 1);
  await churn();
  assert.equal(count(), 1);
});

test('N-C control: a non-throwing observer keeps the previous outcome semantics', async () => {
  const seen = [];
  const { getStatus } = countingStatus([projection('APPLY_COMPLETED')]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    delayFn: IMMEDIATE,
    onObservation: (p) => seen.push(p.state),
  });
  assert.deepEqual(seen, ['APPLY_COMPLETED']);
  assert.equal(outcome.kind, 'APPLIED');
});
