/**
 * computeScheduleDiff — determinism, ordering, hash stability, and the
 * F-B1/F-N7 repair regressions:
 *   - exception UPDATE ops must carry full before/after snapshots (kind,
 *     hours, note) so the consent dialog can show exactly what will change;
 *   - exception REMOVE ops must carry the removed entry (kind/hours);
 *   - non-canonical weekday buckets must surface, never silently drop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeScheduleDiff,
  describeOp,
  describeExceptionState,
  fnv1aHex,
  stableStringify,
} from '../../src/ui/diff/computeScheduleDiff.js';

function ruleSet(overrides = {}) {
  return {
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
    ...overrides,
  };
}

test('identical inputs produce identical ops and hash (determinism)', () => {
  const a = ruleSet({
    locationWindows: { l1: { MON: [{ start: '09:00', end: '12:00' }] } },
    exceptions: [{ exceptionId: 'e1', date: '2026-12-25', kind: 'CLOSED', windows: [] }],
  });
  const b = ruleSet({
    locationWindows: { l1: { MON: [{ start: '09:00', end: '12:00' }] } },
    exceptions: [{ exceptionId: 'e1', date: '2026-12-25', kind: 'CLOSED', windows: [] }],
  });
  const first = computeScheduleDiff(a, b);
  const second = computeScheduleDiff(a, b);
  assert.deepEqual(first.ops, second.ops);
  assert.equal(first.hash, second.hash);
});

test('hash is stable across runs and differs when content differs', () => {
  const saved = ruleSet();
  const draftA = ruleSet({ locationWindows: { l1: { MON: [{ start: '09:00', end: '12:00' }] } } });
  const draftB = ruleSet({ locationWindows: { l1: { MON: [{ start: '10:00', end: '12:00' }] } } });
  assert.equal(computeScheduleDiff(saved, draftA).hash, computeScheduleDiff(saved, draftA).hash);
  assert.notEqual(computeScheduleDiff(saved, draftA).hash, computeScheduleDiff(saved, draftB).hash);
});

test('window additions and removals are emitted per scope/weekday with times', () => {
  const saved = ruleSet({
    locationWindows: {
      l2: { TUE: [{ start: '08:00', end: '10:00' }] },
      l1: { MON: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
    },
  });
  const draft = ruleSet({
    locationWindows: {
      l1: { MON: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
      l2: {},
    },
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.deepEqual(ops, [
    { kind: 'REMOVE_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON', start: '13:00', end: '18:00' },
    { kind: 'ADD_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON', start: '14:00', end: '18:00' },
    { kind: 'REMOVE_WINDOW', scopeType: 'location', scopeId: 'l2', weekday: 'TUE', start: '08:00', end: '10:00' },
  ]);
});

test('F-B1 regression: CLOSED -> OVERRIDE update op exposes prior AND new kind+hours', () => {
  const saved = ruleSet({
    exceptions: [{ exceptionId: 'e1', date: '2026-12-25', kind: 'CLOSED', windows: [], note: '' }],
  });
  const draft = ruleSet({
    exceptions: [
      {
        exceptionId: 'e1',
        date: '2026-12-25',
        kind: 'OVERRIDE',
        windows: [{ start: '10:00', end: '14:00' }],
        note: '',
      },
    ],
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.kind, 'UPDATE_EXCEPTION');
  // The op itself must carry both states...
  assert.equal(op.before.kind, 'CLOSED');
  assert.deepEqual(op.before.windows, []);
  assert.equal(op.after.kind, 'OVERRIDE');
  assert.deepEqual(op.after.windows, [{ start: '10:00', end: '14:00' }]);
  // ...and the rendered consent line must expose BOTH kind and hours.
  const line = describeOp(op);
  assert.match(line, /closed all day/);
  assert.match(line, /open 10:00-14:00/);
  assert.equal(line, 'Change exception - 2026-12-25: closed all day -> open 10:00-14:00');
});

test('F-B1 regression: OVERRIDE -> CLOSED update exposes losing the hours', () => {
  const saved = ruleSet({
    exceptions: [
      {
        exceptionId: 'e2',
        date: '2027-01-02',
        kind: 'OVERRIDE',
        windows: [{ start: '09:00', end: '11:00' }],
      },
    ],
  });
  const draft = ruleSet({
    exceptions: [{ exceptionId: 'e2', date: '2027-01-02', kind: 'CLOSED', windows: [] }],
  });
  const { ops } = computeScheduleDiff(saved, draft);
  const line = describeOp(ops[0]);
  assert.match(line, /open 09:00-11:00/);
  assert.match(line, /closed all day/);
});

test('F-B1 regression: split-window override renders every window in order', () => {
  const saved = ruleSet({
    exceptions: [{ exceptionId: 'e3', date: '2026-07-04', kind: 'CLOSED', windows: [] }],
  });
  const draft = ruleSet({
    exceptions: [
      {
        exceptionId: 'e3',
        date: '2026-07-04',
        kind: 'OVERRIDE',
        windows: [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
        ],
      },
    ],
  });
  const line = describeOp(computeScheduleDiff(saved, draft).ops[0]);
  assert.equal(
    line,
    'Change exception - 2026-07-04: closed all day -> open 09:00-12:00, 14:00-18:00',
  );
});

test('F-B1 regression: note changes are included in UPDATE_EXCEPTION lines', () => {
  const saved = ruleSet({
    exceptions: [
      { exceptionId: 'e4', date: '2026-05-01', kind: 'CLOSED', windows: [], note: 'staff training' },
    ],
  });
  const draft = ruleSet({
    exceptions: [
      { exceptionId: 'e4', date: '2026-05-01', kind: 'OVERRIDE', windows: [{ start: '10:00', end: '12:00' }], note: 'late opening' },
    ],
  });
  const line = describeOp(computeScheduleDiff(saved, draft).ops[0]);
  assert.match(line, /closed all day -> open 10:00-12:00/);
  assert.match(line, /\(note: 'staff training' -> 'late opening'\)/);
});

test('F-B1 regression: note added or removed is surfaced', () => {
  const base = { exceptionId: 'e5', date: '2026-03-15', kind: 'CLOSED', windows: [] };
  const saved = ruleSet({ exceptions: [base] });
  const withNote = ruleSet({
    exceptions: [{ ...base, note: 'public holiday' }],
  });

  const addedLine = describeOp(computeScheduleDiff(saved, withNote).ops[0]);
  assert.match(addedLine, /\(note added: 'public holiday'\)/);

  const removedLine = describeOp(computeScheduleDiff(withNote, saved).ops[0]);
  assert.match(removedLine, /\(note removed: 'public holiday'\)/);

  // Identical inputs produce no update op at all (hence no note clause).
  assert.equal(computeScheduleDiff(withNote, withNote).ops.length, 0);
});

test('F-B1 regression: REMOVE_EXCEPTION describes the removed entry kind/hours', () => {
  const saved = ruleSet({
    exceptions: [
      {
        exceptionId: 'e6',
        date: '2026-11-26',
        kind: 'OVERRIDE',
        windows: [
          { start: '10:00', end: '13:00' },
          { start: '15:00', end: '18:00' },
        ],
        note: 'thanksgiving short day',
      },
    ],
  });
  const draft = ruleSet({ exceptions: [] });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, 'REMOVE_EXCEPTION');
  // The removal line must expose what is being lost, not just the date.
  const line = describeOp(ops[0]);
  assert.equal(
    line,
    "Remove exception - 2026-11-26: open 10:00-13:00, 15:00-18:00 (note: 'thanksgiving short day')",
  );

  const closedSaved = ruleSet({
    exceptions: [{ exceptionId: 'e7', date: '2026-11-27', kind: 'CLOSED', windows: [] }],
  });
  const closedLine = describeOp(computeScheduleDiff(closedSaved, ruleSet()).ops[0]);
  assert.equal(closedLine, 'Remove exception - 2026-11-27: closed all day');
});

test('ADD_EXCEPTION line includes kind and hours', () => {
  const draft = ruleSet({
    exceptions: [
      { exceptionId: 'e8', date: '2026-08-30', kind: 'OVERRIDE', windows: [{ start: '11:00', end: '16:00' }] },
    ],
  });
  const line = describeOp(computeScheduleDiff(ruleSet(), draft).ops[0]);
  assert.equal(line, 'Add exception - 2026-08-30: open 11:00-16:00');
});

test('F-N7 regression: unknown weekday bucket surfaces as an explicit op', () => {
  const saved = ruleSet({ locationWindows: {} });
  const draft = ruleSet({
    // A corrupted/legacy bucket that is not a canonical weekday key.
    locationWindows: { l1: { SUNDAYS: [{ start: '09:00', end: '12:00' }] } },
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, 'UNKNOWN_WEEKDAY');
  assert.equal(ops[0].weekday, 'SUNDAYS');
  assert.equal(ops[0].scopeId, 'l1');
  const line = describeOp(ops[0]);
  assert.match(line, /SUNDAYS/);
  assert.match(line, /resolve this entry before applying/);
});

test('F-N7 regression: unknown weekday present only on the SAVED side also surfaces', () => {
  const saved = ruleSet({ serviceWindows: { s1: { WEEKEND: [{ start: '09:00', end: '12:00' }] } } });
  const draft = ruleSet({ serviceWindows: { s1: {} } });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, 'UNKNOWN_WEEKDAY');
  assert.equal(ops[0].weekday, 'WEEKEND');
});

test('limit changes render from -> to including creation and removal', () => {
  const saved = ruleSet({
    limits: [
      { limitId: 'a', dimension: 'DAY', targetId: null, maxCount: 10, includedStatuses: ['PENDING'] },
      { limitId: 'b', dimension: 'SERVICE', targetId: 's1', maxCount: 4, includedStatuses: ['PENDING'] },
    ],
  });
  const draft = ruleSet({
    limits: [
      { limitId: 'a', dimension: 'DAY', targetId: null, maxCount: 25, includedStatuses: ['PENDING'] },
      { limitId: 'c', dimension: 'LOCATION', targetId: 'l9', maxCount: 3, includedStatuses: ['PENDING'] },
    ],
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.deepEqual(
    ops.map((op) => describeOp(op)),
    [
      'Set day booking limit: 10 -> 25 per day',
      'Set service booking limit for s1: 4 -> none per service',
      'Set location booking limit for l9: none -> 3 per location',
    ],
  );
});

test('incomplete window rows never become schedule operations', () => {
  const saved = ruleSet();
  const draft = ruleSet({
    locationWindows: { l1: { MON: [{ start: '', end: '' }, { start: '09:00', end: '' }] } },
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 0);
});

test('exception identity is the date; id-only changes do not fabricate churn', () => {
  const saved = ruleSet({
    exceptions: [{ exceptionId: 'old-id', date: '2026-12-24', kind: 'CLOSED', windows: [] }],
  });
  const draft = ruleSet({
    exceptions: [{ exceptionId: 'new-id', date: '2026-12-24', kind: 'CLOSED', windows: [] }],
  });
  const { ops } = computeScheduleDiff(saved, draft);
  assert.equal(ops.length, 0);
});

test('ordering is deterministic across scopes, weekdays and mixed op kinds', () => {
  const saved = ruleSet({
    locationWindows: { lb: { SUN: [{ start: '10:00', end: '12:00' }] }, la: { MON: [{ start: '08:00', end: '09:00' }] } },
    serviceWindows: { s1: { FRI: [{ start: '12:00', end: '14:00' }] } },
    exceptions: [{ exceptionId: 'x', date: '2026-09-01', kind: 'CLOSED', windows: [] }],
  });
  const draft = ruleSet({
    locationWindows: { la: { MON: [{ start: '08:00', end: '09:30' }] }, lb: {} },
    serviceWindows: { s1: { FRI: [{ start: '12:00', end: '15:00' }] } },
    exceptions: [],
    limits: [{ limitId: 'd', dimension: 'DAY', targetId: null, maxCount: 5, includedStatuses: [] }],
  });
  const { ops } = computeScheduleDiff(saved, draft);
  // Deterministic order: scopes sorted (la before lb), per bucket removals
  // precede additions, locations before services, then exceptions by date,
  // then limits by dimension.
  assert.deepEqual(
    ops.map((op) => `${op.kind}:${op.scopeType ?? op.date ?? op.dimension}`),
    [
      'REMOVE_WINDOW:location',
      'ADD_WINDOW:location',
      'REMOVE_WINDOW:location',
      'REMOVE_WINDOW:service',
      'ADD_WINDOW:service',
      'REMOVE_EXCEPTION:2026-09-01',
      'SET_LIMIT:DAY',
    ],
  );
});

test('describeExceptionState covers closed, override and unknown kinds', () => {
  assert.equal(describeExceptionState('CLOSED', []), 'closed all day');
  assert.equal(describeExceptionState('OVERRIDE', [{ start: '09:00', end: '10:00' }]), 'open 09:00-10:00');
  assert.equal(describeExceptionState('OVERRIDE', []), 'open (no windows)');
  assert.equal(describeExceptionState('WEIRD', []), 'unknown type WEIRD');
});

test('stableStringify is key-order independent; fnv1aHex is a stable digest', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.equal(fnv1aHex(''), '811c9dc5');
  assert.equal(fnv1aHex('hello'), fnv1aHex('hello'));
  assert.notEqual(fnv1aHex('hello'), fnv1aHex('hellp'));
});
