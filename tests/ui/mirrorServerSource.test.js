/**
 * Validation mirror — server-shaped ValidationResult injection (DASH-C3-1d,
 * F-N1 repoint seam preparation).
 *
 * Proves:
 *   - a server-side ValidationResult ({valid, issues} exactly as returned by
 *     the PUT /ruleset domain-side validation, canonical src/domain/validate.ts)
 *     can be injected VERBATIM and drives validateDraft output unchanged;
 *   - with NO configured source the provisional bundled validators remain the
 *     offline fallback and behavior is byte-for-byte today's;
 *   - non-conforming sources are rejected fail-closed (previous source stays
 *     active — validation can never be silently disabled);
 *   - injected results are snapshotted so later external mutation of the
 *     response object cannot retroactively change what was validated.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setValidationSource,
  resetValidationSource,
  currentValidationSource,
  validateDraft,
} from '../../src/ui/validation/mirror.js';
import { validateRuleDraft } from '../../src/ui/validation/ruleDraftValidators.js';

const DRAFT = {
  locationWindows: {},
  serviceWindows: {},
  exceptions: [],
  limits: [],
};

test('accepts a server-shaped ValidationResult and returns its issues verbatim', () => {
  resetValidationSource();
  const serverResult = {
    valid: false,
    issues: [
      { path: 'locationWindows.l1.MON[0]', code: 'WINDOW_INCOMPLETE', message: 'Window 1 on MON is incomplete.' },
      { path: 'limits[0].maxCount', code: 'LIMIT_NOT_INTEGER', message: 'Limit must be a whole number.' },
    ],
  };
  assert.equal(setValidationSource(serverResult), true);
  const issues = validateDraft(DRAFT, [], []);
  assert.deepEqual(issues, serverResult.issues, 'issues pass through verbatim (same codes/messages/paths)');
});

test('a valid server result ({valid:true, issues:[]}) yields zero issues', () => {
  resetValidationSource();
  assert.equal(setValidationSource({ valid: true, issues: [] }), true);
  assert.deepEqual(validateDraft(DRAFT), []);
});

test('server issues render through the page contract unchanged (message equality)', () => {
  resetValidationSource();
  const message = 'End must be strictly after start.';
  setValidationSource({
    valid: false,
    issues: [{ path: 'serviceWindows.s1.TUE[0]', code: 'INVALID_WINDOW', message }],
  });
  const issues = validateDraft(DRAFT);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].message, message);
});

test('injection snapshots the payload: later external mutation cannot rewrite history', () => {
  resetValidationSource();
  const serverResult = {
    valid: false,
    issues: [{ path: 'p', code: 'CODE_A', message: 'original' }],
  };
  setValidationSource(serverResult);
  // Hostile/buggy integration mutates the response object afterwards.
  serverResult.issues[0].message = 'tampered';
  serverResult.issues.push({ path: 'q', code: 'CODE_B', message: 'extra' });
  assert.deepEqual(validateDraft(DRAFT), [
    { path: 'p', code: 'CODE_A', message: 'original' },
  ]);
});

test('non-conforming sources are rejected and the previous source stays active (fail-closed)', () => {
  resetValidationSource();
  const before = currentValidationSource();
  const badSources = [
    null,
    undefined,
    'validate',
    42,
    [],
    { issues: [] }, // missing valid
    { valid: true }, // missing issues
    { valid: 'yes', issues: [] }, // wrong valid type
    { valid: true, issues: 'none' }, // issues not an array
    { valid: true, issues: [null] }, // non-object issue
    { valid: true, issues: [{ path: 'p', code: 'C' }] }, // missing message
    { valid: true, issues: [{ path: 'p', message: 'm' }] }, // missing code
    { valid: true, issues: [{ code: 'C', message: 'm' }] }, // missing path
    { valid: true, issues: [{ path: 1, code: 'C', message: 'm' }] }, // non-string field
  ];
  for (const bad of badSources) {
    assert.equal(setValidationSource(bad), false, `expected rejection of ${JSON.stringify(bad)}`);
    assert.equal(currentValidationSource(), before, 'previous source untouched');
  }
  // Validation still works through the previously active (bundled) source.
  assert.ok(
    validateDraft({ locationWindows: { l1: { MON: [{ start: '', end: '' }] } } }).length > 0,
  );
});

test('unconfigured default: bundled provisional validators remain active (behavior unchanged)', () => {
  resetValidationSource();
  assert.equal(currentValidationSource(), validateRuleDraft);
  const draftInput = {
    locationWindows: { l1: { FRI: [{ start: '18:00', end: '09:00' }] } },
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
  assert.deepEqual(validateDraft(draftInput), validateRuleDraft(draftInput));
});

test('reset restores the offline fallback after a server-source session', () => {
  resetValidationSource();
  setValidationSource({ valid: true, issues: [] });
  assert.notEqual(currentValidationSource(), validateRuleDraft);
  resetValidationSource();
  assert.equal(currentValidationSource(), validateRuleDraft);
});
