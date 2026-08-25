/**
 * editorStore — consent gating state machine.
 *
 * Repair regressions (F-B2, reducer layer): OPEN_DIFF_PREVIEW is refused while
 * validation issues exist; CONFIRM_DIFF_PREVIEW never lands unless the modal
 * is open, the hash matches the current draft, and zero issues are open; any
 * draft edit invalidates a prior confirmation (stale-hash replay rejected).
 *
 * Repair regressions (F-N4): save/apply transitions expose pending /
 * unavailable / saved / applied states with visible messages instead of
 * silent no-ops.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEditorStore,
  emptyDraft,
  describeBridgeFailure,
} from '../../src/ui/state/editorStore.js';
import { computeScheduleDiff } from '../../src/ui/diff/computeScheduleDiff.js';
import { BridgeError } from '../../src/ui/services/bridge.js';

function baseInput(overrides = {}) {
  return {
    savedRuleSet: null,
    locations: [{ id: 'l1', label: 'Downtown' }],
    services: [{ id: 's1', label: 'Consultation' }],
    ...overrides,
  };
}

function draftWithCompleteWindow() {
  const draft = emptyDraft();
  draft.locationWindows.l1 = { MON: [{ start: '09:00', end: '12:00' }] };
  return draft;
}

test('fresh store with an incomplete row reports a WINDOW_INCOMPLETE issue', () => {
  const store = createEditorStore(baseInput());
  assert.equal(store.getState().issues.length, 0);
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  assert.equal(store.getState().issues.length, 1);
  assert.equal(store.getState().issues[0].code, 'WINDOW_INCOMPLETE');
});

test('F-B2: OPEN_DIFF_PREVIEW is refused while issues exist and sets a visible notice', () => {
  const store = createEditorStore(baseInput());
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const state = store.getState();
  assert.equal(state.diffPreview.open, false);
  assert.equal(state.notice.kind, 'REVIEW_BLOCKED');
  assert.match(state.notice.message, /Fix 1 validation issue before reviewing changes/);
});

test('F-B2: CONFIRM_DIFF_PREVIEW cannot land while issues exist even if forced', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  // Force an issue AFTER computing what the hash would be.
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'TUE' });
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
  assert.equal(store.getState().confirmedHash, null);
  assert.equal(store.canApply(), false);
});

test('happy path: open -> confirm -> canApply, then edit invalidates', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  assert.deepEqual(store.getState().issues, []);

  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  assert.equal(store.getState().diffPreview.renderedHash, hash);
  // canConfirmDiff (modal Confirm enablement) is true pre-confirmation;
  // canApply (Apply enablement) is not — confirmation must land first.
  assert.equal(store.canConfirmDiff(), true);
  assert.equal(store.canApply(), false);

  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
  assert.equal(store.getState().confirmedHash, hash);
  assert.equal(store.canApply(), true);

  // Any draft mutation invalidates the confirmation.
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '10:00' },
  });
  assert.equal(store.getState().confirmedHash, null);
  assert.equal(store.canConfirmDiff(), false, 'rendered hash is stale after edits');
  assert.equal(store.canApply(), false);
});

test('canConfirmDiff is false while issues exist even if a preview were open', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  // Force an issue AFTER opening the preview.
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'TUE' });
  assert.equal(store.getState().issues.length, 1);
  assert.equal(store.canConfirmDiff(), false);
});

test('stale-hash replay is rejected after edits', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const staleHash = store.getState().diffPreview.renderedHash;

  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { end: '13:00' },
  });
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' }); // re-render for new hash
  const newHash = store.getState().diffPreview.renderedHash;
  assert.notEqual(staleHash, newHash);

  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', staleHashReplay: true, hash: staleHash });
  assert.equal(store.getState().confirmedHash, null);

  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: newHash });
  assert.equal(store.getState().confirmedHash, newHash);
});

test('confirming without an open modal is refused', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
  assert.equal(store.getState().confirmedHash, null);
});

test('canApply tracks hash equality: no-op round trip keeps consent, real change requires re-confirm', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
  assert.equal(store.canApply(), true);

  // Mutate away and back: the intermediate edit invalidated the confirmation,
  // and even though the final draft hashes identically again, consent must be
  // re-established explicitly.
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { end: '12:30' },
  });
  assert.equal(store.canApply(), false);
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { end: '12:00' },
  });
  const revertedHash = computeScheduleDiff(null, store.getState().draft).hash;
  assert.equal(revertedHash, hash); // content identical...
  assert.equal(store.getState().confirmedHash, null); // ...but consent gone
  assert.equal(store.canApply(), false);

  // Re-reviewing and re-confirming restores apply permission.
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: revertedHash });
  assert.equal(store.canApply(), true);
});

test('exception mutations invalidate confirmation too', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
  assert.equal(store.canApply(), true);

  store.dispatch({ type: 'ADD_EXCEPTION', date: '2026-12-25' });
  assert.equal(store.canApply(), false);
  assert.equal(store.getState().confirmedHash, null);
});

test('F-N4: save flow exposes pending then unavailable with a visible message', async () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  const failingBridge = {
    async saveRuleSet() {
      throw new BridgeError('BRIDGE_NOT_CONFIGURED', 'not connected');
    },
  };

  // Simulate the page-level flow around the store.
  store.dispatch({ type: 'SAVE_START' });
  assert.equal(store.getState().saveStatus, 'pending');
  try {
    await failingBridge.saveRuleSet(store.getState().draft);
    assert.fail('bridge should have failed');
  } catch (error) {
    store.dispatch({
      type: 'SAVE_UNAVAILABLE',
      message: describeBridgeFailure(error, 'Save'),
    });
  }
  const state = store.getState();
  assert.equal(state.saveStatus, 'unavailable');
  assert.match(state.lastSaveMessage, /Save is unavailable: the app backend is not connected yet/);
});

test('F-N4: successful save swaps saved snapshot and clears confirmation', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  const { hash } = computeScheduleDiff(null, store.getState().draft);
  store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });

  store.dispatch({ type: 'SAVE_SUCCESS', savedRuleSet: store.getState().draft });
  const state = store.getState();
  assert.equal(state.saveStatus, 'saved');
  assert.equal(state.confirmedHash, null);
  assert.deepEqual(computeScheduleDiff(state.savedRuleSet, state.draft).ops, []);
});

test('apply success resets diff session and marks applied', () => {
  const store = createEditorStore(baseInput({ draft: draftWithCompleteWindow() }));
  store.dispatch({ type: 'APPLY_START' });
  assert.equal(store.getState().applyStatus, 'pending');
  store.dispatch({ type: 'APPLY_SUCCESS' });
  const state = store.getState();
  assert.equal(state.applyStatus, 'applied');
  assert.equal(state.diffPreview.open, false);
  assert.equal(state.confirmedHash, null);
});

test('describeBridgeFailure maps every typed code to user-safe text', () => {
  assert.match(
    describeBridgeFailure(new BridgeError('BRIDGE_NOT_CONFIGURED', 'x'), 'Save'),
    /backend is not connected yet/,
  );
  assert.match(describeBridgeFailure(new BridgeError('TRANSPORT_FAILURE', 'x'), 'Apply'), /network problem/);
  assert.match(describeBridgeFailure(new BridgeError('BAD_RESPONSE', 'x'), 'Save'), /unreadable response/);
  assert.match(describeBridgeFailure(new BridgeError('HTTP_500', 'x', { status: 500 }), 'Apply'), /status 500/);
  assert.match(describeBridgeFailure(new Error('boom'), 'Save'), /failed unexpectedly/);
});

test('SET_LIMIT stores numeric values and clears on empty input', () => {
  const store = createEditorStore(baseInput());
  store.dispatch({ type: 'SET_LIMIT', dimension: 'DAY', targetId: null, rawValue: 5 });
  assert.equal(store.getState().draft.limits.length, 1);
  assert.equal(store.getState().draft.limits[0].maxCount, 5);
  store.dispatch({ type: 'SET_LIMIT', dimension: 'DAY', targetId: null, rawValue: '' });
  assert.equal(store.getState().draft.limits.length, 0);
});

test('-0 cap is preserved as a valid zero limit', () => {
  const store = createEditorStore(baseInput());
  store.dispatch({ type: 'SET_LIMIT', dimension: 'SERVICE', targetId: 's1', rawValue: -0 });
  const limits = store.getState().draft.limits;
  assert.equal(limits.length, 1);
  assert.ok(Object.is(limits[0].maxCount, -0) || limits[0].maxCount === 0);
});
