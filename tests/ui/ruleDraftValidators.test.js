/**
 * Provisional rule-draft validators — negative/edge coverage for the
 * configuration rules the UI enforces before any review/confirm flow.
 * (Provisional bundle per audit F-N1; semantics repoint is Director-tracked.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateRuleDraft,
  validateWindowBucket,
  validateLimit,
  validateException,
  isValidLocalDate,
} from '../../src/ui/validation/ruleDraftValidators.js';

function draft(overrides = {}) {
  return {
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
    ...overrides,
  };
}

test('end <= start is rejected; equal times are zero-length', () => {
  const issues = validateWindowBucket('location', 'l1', 'MON', [
    { start: '10:00', end: '09:00' },
  ]);
  assert.deepEqual(
    issues.map((i) => i.code),
    ['WINDOW_END_BEFORE_START'],
  );
  assert.match(issues[0].message, /end time must be after start time/);

  const zero = validateWindowBucket('location', 'l1', 'MON', [{ start: '10:00', end: '10:00' }]);
  assert.equal(zero[0].code, 'WINDOW_ZERO_LENGTH');
});

test('adjacent windows are allowed; chained overlaps produce one issue per pair', () => {
  const adjacent = validateWindowBucket('location', 'l1', 'MON', [
    { start: '09:00', end: '12:00' },
    { start: '12:00', end: '14:00' },
  ]);
  assert.deepEqual(adjacent, []);

  const chained = validateWindowBucket('location', 'l1', 'MON', [
    { start: '09:00', end: '12:00' },
    { start: '11:00', end: '13:00' },
    { start: '12:30', end: '15:00' },
  ]);
  assert.equal(chained.filter((i) => i.code === 'WINDOW_OVERLAP').length, 2);
});

test('incomplete rows are flagged so they can never reach the diff', () => {
  const both = validateWindowBucket('location', 'l1', 'MON', [{ start: '', end: '' }]);
  assert.equal(both[0].code, 'WINDOW_INCOMPLETE');

  const half = validateWindowBucket('location', 'l1', 'TUE', [{ start: '09:00', end: '' }]);
  assert.equal(half[0].code, 'WINDOW_HALF_EMPTY');
});

test('malformed times are rejected with HH:MM guidance', () => {
  const issues = validateWindowBucket('location', 'l1', 'WED', [
    { start: '9am', end: '25:00' },
  ]);
  assert.deepEqual(
    issues.map((i) => i.code),
    ['WINDOW_BAD_START', 'WINDOW_BAD_END'],
  );
});

test('time parsing captures the minutes group (regression: NaN comparisons silently passed)', () => {
  // Regression guard for a real defect found during DASH-C2-1-REPAIR: the
  // HH:MM pattern originally captured only the hour group, so toMinutes
  // returned NaN and every end<=start / overlap check compared NaN (always
  // false) and silently passed invalid rows. If this test fails, the minute
  // capture group was lost again.
  const issues = validateWindowBucket('location', 'l1', 'MON', [
    { start: '10:00', end: '09:30' },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'WINDOW_END_BEFORE_START');

  const halfHour = validateWindowBucket('location', 'l1', 'TUE', [
    { start: '09:00', end: '09:30' },
    { start: '09:15', end: '10:00' },
  ]);
  assert.equal(halfHour.filter((i) => i.code === 'WINDOW_OVERLAP').length, 1);
});

test('cap validation: -0 accepted as zero; "+5", 1.5 and -3 rejected', () => {
  assert.deepEqual(validateLimit('DAY', null, -0), []);
  assert.deepEqual(validateLimit('DAY', null, 0), []);
  // Canonical integer strings are coerced by the store before storage, so a
  // string reaching the validator is by definition non-canonical input.
  assert.equal(validateLimit('DAY', null, '+5')[0].code, 'LIMIT_NOT_INTEGER');
  assert.equal(validateLimit('DAY', null, '5')[0].code, 'LIMIT_NOT_INTEGER');

  const fractional = validateLimit('SERVICE', 's1', 1.5);
  assert.equal(fractional[0].code, 'LIMIT_NOT_INTEGER');

  const negative = validateLimit('LOCATION', 'l1', -3);
  assert.equal(negative[0].code, 'LIMIT_NEGATIVE');

  // Empty means "no limit configured", not an error.
  assert.deepEqual(validateLimit('DAY', null, ''), []);
});

test('leap years: 2028-02-29 valid, 2027-02-29 and 2026-02-30 invalid', () => {
  assert.equal(isValidLocalDate('2028-02-29'), true);
  assert.equal(isValidLocalDate('2027-02-29'), false);
  assert.equal(isValidLocalDate('2026-02-30'), false);
  assert.equal(isValidLocalDate('2000-02-29'), true);
  assert.equal(isValidLocalDate('1900-02-29'), false);
});

test('exception validation: missing date, bad date, unknown kind, empty override', () => {
  const missingDate = validateException({ exceptionId: 'a', date: '', kind: 'CLOSED' }, []);
  assert.equal(missingDate[0].code, 'EXCEPTION_DATE_MISSING');

  const badDate = validateException({ exceptionId: 'b', date: '2026-02-30', kind: 'CLOSED' }, []);
  assert.equal(badDate[0].code, 'EXCEPTION_DATE_INVALID');

  const badKind = validateException({ exceptionId: 'c', date: '2026-01-01', kind: 'WEIRD' }, []);
  assert.equal(badKind[0].code, 'EXCEPTION_KIND_UNKNOWN');

  const emptyOverride = validateException(
    { exceptionId: 'd', date: '2026-01-02', kind: 'OVERRIDE', windows: [] },
    [],
  );
  assert.equal(emptyOverride[0].code, 'EXCEPTION_OVERRIDE_EMPTY');

  const badOverrideTime = validateException(
    { exceptionId: 'e', date: '2026-01-03', kind: 'OVERRIDE', windows: [{ start: '14:00', end: '09:00' }] },
    [],
  );
  assert.equal(badOverrideTime[0].code, 'EXCEPTION_WINDOW_ORDER');
});

test('duplicate exception dates are flagged once per offending entry', () => {
  const a = { exceptionId: 'x1', date: '2026-12-24', kind: 'CLOSED' };
  const b = { exceptionId: 'x2', date: '2026-12-24', kind: 'CLOSED' };
  const issuesA = validateException(a, [a, b]);
  const issuesB = validateException(b, [a, b]);
  assert.equal(issuesA.some((i) => i.code === 'EXCEPTION_DUPLICATE_DATE'), true);
  assert.equal(issuesB.some((i) => i.code === 'EXCEPTION_DUPLICATE_DATE'), true);
  assert.deepEqual(validateException(a, [a]), []);
});

test('whole-draft validation surfaces unknown weekday buckets (F-N7 pairing)', () => {
  const issues = validateRuleDraft(
    draft({ locationWindows: { l1: { SUNDAYS: [{ start: '09:00', end: '12:00' }] } } }),
    [{ id: 'l1', label: 'Downtown' }],
  );
  assert.equal(issues[0].code, 'WEEKDAY_UNKNOWN');
  assert.match(issues[0].message, /is not a weekday this editor manages/);
});

test('whole-draft validation flags window scopes referencing unknown locations/services', () => {
  const issues = validateRuleDraft(
    draft({ serviceWindows: { ghost: { MON: [{ start: '09:00', end: '10:00' }] } } }),
    [],
    [{ id: 's1', label: 'Consultation' }],
  );
  assert.equal(issues.some((i) => i.code === 'SCOPE_UNKNOWN'), true);
});

test('valid full draft produces zero issues', () => {
  const valid = draft({
    locationWindows: {
      l1: {
        MON: [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
        ],
      },
    },
    serviceWindows: { s1: { TUE: [{ start: '10:00', end: '13:00' }] } },
    exceptions: [
      { exceptionId: 'e1', date: '2028-02-29', kind: 'CLOSED' },
      { exceptionId: 'e2', date: '2026-12-25', kind: 'OVERRIDE', windows: [{ start: '10:00', end: '14:00' }] },
    ],
    limits: [
      { limitId: 'd', dimension: 'DAY', targetId: null, maxCount: 20, includedStatuses: ['PENDING'] },
      { limitId: 's', dimension: 'SERVICE', targetId: 's1', maxCount: 5, includedStatuses: ['PENDING'] },
      { limitId: 'l', dimension: 'LOCATION', targetId: 'l1', maxCount: 15, includedStatuses: ['PENDING'] },
    ],
  });
  assert.deepEqual(
    validateRuleDraft(valid, [{ id: 'l1', label: 'Downtown' }], [{ id: 's1', label: 'Consultation' }]),
    [],
  );
});
