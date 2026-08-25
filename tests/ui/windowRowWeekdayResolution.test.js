/**
 * Row-scoped weekday resolution regression guard (renamed from the cycle-1
 * debug filename per audit finding F-N6 — content is a permanent regression
 * guard).
 *
 * Proves that each window row resolves its weekday from its OWN row scope:
 * editing, adding or removing a row on one weekday never clobbers sibling
 * rows on other weekdays, other rows on the same weekday, or rows under a
 * different scope of the same kind.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEditorStore } from '../../src/ui/state/editorStore.js';
import { computeScheduleDiff } from '../../src/ui/diff/computeScheduleDiff.js';

function storeWithRows() {
  const store = createEditorStore({
    savedRuleSet: null,
    locations: [
      { id: 'l1', label: 'Downtown' },
      { id: 'l2', label: 'Airport' },
    ],
  });
  // l1/MON row 0 + row 1 (split), l1/TUE row 0, l2/MON row 0.
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'TUE' });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l2', weekday: 'MON' });
  const patch = (scopeId, weekday, index, patchFields) =>
    store.dispatch({
      type: 'PATCH_WEEK_WINDOW',
      scopeType: 'location',
      scopeId,
      weekday,
      index,
      patch: patchFields,
    });
  patch('l1', 'MON', 0, { start: '09:00', end: '12:00' });
  patch('l1', 'MON', 1, { start: '14:00', end: '18:00' });
  patch('l1', 'TUE', 0, { start: '10:00', end: '13:00' });
  patch('l2', 'MON', 0, { start: '08:00', end: '11:00' });
  return { store, patch };
}

test('editing Monday row 2 leaves every sibling row untouched', () => {
  const { store, patch } = storeWithRows();
  patch('l1', 'MON', 1, { start: '15:00' });

  const windows = store.getState().draft.locationWindows;
  assert.deepEqual(windows.l1.MON[0], { start: '09:00', end: '12:00' });
  assert.deepEqual(windows.l1.MON[1], { start: '15:00', end: '18:00' });
  assert.deepEqual(windows.l1.TUE[0], { start: '10:00', end: '13:00' });
  assert.deepEqual(windows.l2.MON[0], { start: '08:00', end: '11:00' });
});

test('removing Monday row 1 preserves the split partner and other weekdays', () => {
  // Start from a SAVED rule set that already contains all four rows, so
  // removing one draft row produces exactly one REMOVE_WINDOW op.
  const saved = {
    locationWindows: {
      l1: {
        MON: [
          { weekday: 'MON', start: '09:00', end: '12:00' },
          { weekday: 'MON', start: '14:00', end: '18:00' },
        ],
        TUE: [{ weekday: 'TUE', start: '10:00', end: '13:00' }],
      },
      l2: { MON: [{ weekday: 'MON', start: '08:00', end: '11:00' }] },
    },
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
  const store = createEditorStore({
    savedRuleSet: saved,
    locations: [
      { id: 'l1', label: 'Downtown' },
      { id: 'l2', label: 'Airport' },
    ],
  });
  assert.deepEqual(store.getState().issues, []);

  store.dispatch({
    type: 'REMOVE_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
  });

  const windows = store.getState().draft.locationWindows;
  assert.equal(windows.l1.MON.length, 1);
  // Rows cloned from the saved rule set keep the canonical WeeklyWindowDTO
  // shape (weekday included); rows added fresh in the editor carry only
  // start/end until persisted.
  assert.deepEqual(windows.l1.MON[0], { weekday: 'MON', start: '14:00', end: '18:00' });
  assert.deepEqual(windows.l1.TUE[0], { weekday: 'TUE', start: '10:00', end: '13:00' });
  assert.deepEqual(windows.l2.MON[0], { weekday: 'MON', start: '08:00', end: '11:00' });

  // Diff shows exactly one removal — no phantom churn on siblings.
  const { ops } = computeScheduleDiff(saved, store.getState().draft);
  const removals = ops.filter((op) => op.kind === 'REMOVE_WINDOW');
  assert.deepEqual(removals, [
    { kind: 'REMOVE_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON', start: '09:00', end: '12:00' },
  ]);
});

test('same-named weekday buckets under different scopes stay independent', () => {
  const { store, patch } = storeWithRows();
  patch('l2', 'MON', 0, { end: '17:00' });

  const windows = store.getState().draft.locationWindows;
  assert.deepEqual(windows.l1.MON[0].end, '12:00');
  assert.deepEqual(windows.l2.MON[0].end, '17:00');
});

test('phantom non-canonical bucket cannot hide behind canonical editing (F-N7 pairing)', () => {
  const { store } = storeWithRows();
  // Simulate legacy/corrupted data injected into the draft.
  store.getState().draft.locationWindows.l1.SUNDAYS = [{ start: '07:00', end: '09:00' }];
  const { ops } = computeScheduleDiff(null, store.getState().draft);
  const unknown = ops.filter((op) => op.kind === 'UNKNOWN_WEEKDAY');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].weekday, 'SUNDAYS');
});
