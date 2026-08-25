/**
 * mutationPoller — bounded terminal-state poll controller (DASH-C3-1b).
 *
 * Adversarial proofs required by the task:
 *   - NO INFINITE LOOP: with every observation non-terminal, the controller
 *     stops after exactly maxAttempts probes and returns EXHAUSTED.
 *   - STOPS PERMANENTLY ON TERMINAL: the first terminal observation ends
 *     polling; no further probe happens even after additional time passes.
 *   - STOPS PERMANENTLY ON ERROR: a rejected probe ends polling after exactly
 *     that attempt; nothing resumes it.
 *   - Terminal-state classification mirrors the accepted orchestrator
 *     allowlist ({SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS} = non-terminal).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pollMutationUntilTerminal,
  isTerminalMutationState,
  classifyTerminalState,
  NON_TERMINAL_MUTATION_STATES,
} from '../../src/ui/state/mutationPoller.js';

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

test('terminal state on the first observation: exactly one probe, outcome APPLIED', async () => {
  const { getStatus, count } = countingStatus([projection('APPLY_COMPLETED')]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 8,
    delayMs: 0,
    delayFn: IMMEDIATE,
  });
  assert.equal(outcome.kind, 'APPLIED');
  assert.equal(outcome.state, 'APPLY_COMPLETED');
  assert.equal(outcome.attempts, 1);
  assert.equal(count(), 1);
});

test('ROLLED_BACK and RECOVERED terminal states map to their own outcomes', async () => {
  for (const [state, expected] of [
    ['ROLLED_BACK', 'ROLLED_BACK'],
    ['RECOVERED', 'RECOVERED'],
  ]) {
    const { getStatus, count } = countingStatus([projection(state)]);
    const outcome = await pollMutationUntilTerminal({ getStatus, delayFn: IMMEDIATE });
    assert.equal(outcome.kind, expected);
    assert.equal(count(), 1);
  }
});

test('an unknown future journal state is failed-terminal carrying the raw state', async () => {
  const { getStatus } = countingStatus([projection('SOME_FUTURE_STATE')]);
  const outcome = await pollMutationUntilTerminal({ getStatus, delayFn: IMMEDIATE });
  assert.equal(outcome.kind, 'FAILED_TERMINAL');
  assert.equal(outcome.state, 'SOME_FUTURE_STATE');
});

test('polls through non-terminal observations until terminal, then stops for good', async () => {
  const { getStatus, count } = countingStatus([
    projection('SNAPSHOT_PERSISTED'),
    projection('APPLY_IN_PROGRESS'),
    projection('APPLY_COMPLETED'),
  ]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 10,
    delayMs: 0,
    delayFn: IMMEDIATE,
  });
  assert.equal(outcome.kind, 'APPLIED');
  assert.equal(outcome.attempts, 3);
  assert.equal(count(), 3);
  // Prove "no polling after terminal": yield the event loop several times;
  // no further probe may fire.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(count(), 3);
});

test('null observations (record not visible yet) are non-terminal; polling continues then terminates', async () => {
  const { getStatus, count } = countingStatus([null, null, projection('APPLY_COMPLETED')]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 6,
    delayMs: 0,
    delayFn: IMMEDIATE,
  });
  assert.equal(outcome.kind, 'APPLIED');
  assert.equal(count(), 3);
});

test('NO INFINITE LOOP: always-non-terminal probing stops at exactly maxAttempts (EXHAUSTED)', async () => {
  const { getStatus, count } = countingStatus(Array.from({ length: 50 }, () => projection('APPLY_IN_PROGRESS')));
  const delays = [];
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 4,
    delayMs: 5,
    delayFn: async (ms) => delays.push(ms),
  });
  assert.equal(outcome.kind, 'EXHAUSTED');
  assert.equal(outcome.attempts, 4);
  assert.equal(outcome.lastState, 'APPLY_IN_PROGRESS');
  assert.equal(count(), 4, 'bounded probe count proves termination');
  // No delay is awaited after the final allowed attempt.
  assert.deepEqual(delays, [5, 5, 5]);
});

test('bridge error stops polling permanently after exactly the failing attempt', async () => {
  const failure = new Error('transport died');
  const { getStatus, count } = countingStatus([failure]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 8,
    delayMs: 0,
    delayFn: IMMEDIATE,
  });
  assert.equal(outcome.kind, 'ERROR');
  assert.equal(outcome.error, failure);
  assert.equal(outcome.attempts, 1);
  assert.equal(count(), 1);
  // Nothing resumes the loop afterwards.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(count(), 1);
});

test('error mid-sequence preserves the last observed state for guidance', async () => {
  const failure = new Error('transport died');
  const { getStatus } = countingStatus([projection('SNAPSHOT_PERSISTED'), failure]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 8,
    delayMs: 0,
    delayFn: IMMEDIATE,
  });
  assert.equal(outcome.kind, 'ERROR');
  assert.equal(outcome.lastState, 'SNAPSHOT_PERSISTED');
  assert.equal(outcome.lastProjection.planId, 'plan-1');
});

test('onObservation sees every non-null projection before the terminal check', async () => {
  const seen = [];
  const { getStatus } = countingStatus([
    projection('SNAPSHOT_PERSISTED'),
    projection('APPLY_COMPLETED'),
  ]);
  await pollMutationUntilTerminal({
    getStatus,
    delayFn: IMMEDIATE,
    onObservation: (p) => seen.push(p.state),
  });
  assert.deepEqual(seen, ['SNAPSHOT_PERSISTED', 'APPLY_COMPLETED']);
});

test('cancellation abandons the loop without further probes', async () => {
  let cancelledAfter = 0;
  const { getStatus, count } = countingStatus([projection('APPLY_IN_PROGRESS'), projection('APPLY_IN_PROGRESS')]);
  const outcome = await pollMutationUntilTerminal({
    getStatus,
    maxAttempts: 10,
    delayMs: 0,
    delayFn: IMMEDIATE,
    isCancelled: () => {
      cancelledAfter += 1;
      return cancelledAfter > 2; // false during first check, true afterwards
    },
  });
  assert.equal(outcome.kind, 'CANCELLED');
  assert.ok(count() <= 2);
});

test('terminal classification mirrors the orchestrator allowlist', () => {
  assert.deepEqual([...NON_TERMINAL_MUTATION_STATES].sort(), ['APPLY_IN_PROGRESS', 'SNAPSHOT_PERSISTED']);
  assert.equal(isTerminalMutationState('SNAPSHOT_PERSISTED'), false);
  assert.equal(isTerminalMutationState('APPLY_IN_PROGRESS'), false);
  assert.equal(isTerminalMutationState('APPLY_COMPLETED'), true);
  assert.equal(isTerminalMutationState('ROLLED_BACK'), true);
  assert.equal(isTerminalMutationState('RECOVERED'), true);
  assert.equal(isTerminalMutationState('ANY_FUTURE_STATE'), true, 'fail-safe: unknown states stop the loop');
  assert.equal(classifyTerminalState('APPLY_COMPLETED'), 'APPLIED');
  assert.equal(classifyTerminalState('ROLLED_BACK'), 'ROLLED_BACK');
  assert.equal(classifyTerminalState('RECOVERED'), 'RECOVERED');
  assert.equal(classifyTerminalState('ANY_FUTURE_STATE'), 'FAILED_TERMINAL');
});
