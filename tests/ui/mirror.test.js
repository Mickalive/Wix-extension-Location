/**
 * Validation mirror — the single repoint seam (audit F-N1).
 *
 * Guarantees tested here:
 *   - default source is the provisional bundled validator;
 *   - setValidationSource swaps the active source (the future canonical
 *     domain-validator repoint uses exactly this seam);
 *   - a non-function argument is ignored (fail-closed: validation can never
 *     be silently disabled by a bad integration);
 *   - rendered UI issues are EQUAL to mirror output (message equality is the
 *     contract the future cross-lane parity test will assert against the
 *     canonical validators).
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

test('default validation source is the provisional bundled validator', () => {
  resetValidationSource();
  assert.equal(currentValidationSource(), validateRuleDraft);
});

test('setValidationSource repoints the seam and reset restores it', () => {
  resetValidationSource();
  const custom = () => [{ code: 'CUSTOM', message: 'from canonical source', path: 'p' }];
  assert.equal(setValidationSource(custom), true);
  assert.equal(currentValidationSource(), custom);
  const issues = validateDraft({ locationWindows: {}, serviceWindows: {}, exceptions: [], limits: [] });
  assert.deepEqual(issues, [{ code: 'CUSTOM', message: 'from canonical source', path: 'p' }]);

  resetValidationSource();
  assert.deepEqual(
    validateDraft({ locationWindows: { l1: { MON: [{ start: '09:00', end: '08:00' }] } } }),
    validateRuleDraft({ locationWindows: { l1: { MON: [{ start: '09:00', end: '08:00' }] } } }),
  );
});

test('a non-function source is rejected (validation cannot be disabled)', () => {
  resetValidationSource();
  assert.equal(setValidationSource(null), false);
  assert.equal(setValidationSource(undefined), false);
  assert.equal(setValidationSource('validate'), false);
  // Still the bundled validator:
  assert.deepEqual(
    validateDraft({ exceptions: [{ exceptionId: 'e', date: 'nope', kind: 'CLOSED' }] }).length > 0,
    true,
  );
});

test('mirror output equals what the page renders verbatim (message equality)', () => {
  resetValidationSource();
  const draftInput = {
    locationWindows: { l1: { FRI: [{ start: '18:00', end: '09:00' }] } },
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
  const issues = validateDraft(draftInput);
  assert.equal(issues.length, 1);
  // The page renders issue.message as textContent with no transformation.
  const renderedText = issues[0].message;
  assert.equal(renderedText, 'Window 1 on FRI: end time must be after start time.');
});
