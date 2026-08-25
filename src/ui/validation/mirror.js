/**
 * Validation mirror — the single seam between the dashboard UI and rule
 * validation semantics.
 *
 * The UI never imports a validator module directly; it asks the mirror. Today
 * the default source is the lane-bundled provisional validator bundle
 * (decision of record for audit finding F-N1). When the Rules lane reaches
 * VERDICT: ACCEPT and ships canonical `src/domain` validators, the Director's
 * tracked obligation is to repoint exactly this seam at the canonical module
 * and add a cross-lane parity contract test asserting message equality. No
 * other dashboard file needs to change.
 */

import { validateRuleDraft as bundledValidateRuleDraft } from './ruleDraftValidators.js';

let validationSource = bundledValidateRuleDraft;

/**
 * Replaces the validation source. Accepts any function
 * `(draft, locations, services) => DraftIssue[]`.
 *
 * Guarded: a non-function argument is ignored so a bad integration cannot
 * silently disable validation (fail-closed posture).
 */
export function setValidationSource(source) {
  if (typeof source !== 'function') return false;
  validationSource = source;
  return true;
}

/** Restores the provisional bundled source (used by tests and recovery). */
export function resetValidationSource() {
  validationSource = bundledValidateRuleDraft;
}

/** Currently active source (exposed for parity/diagnostics tests). */
export function currentValidationSource() {
  return validationSource;
}

/**
 * Validates a draft through the active source.
 * @returns {Array<{code:string,message:string,path:string}>}
 */
export function validateDraft(draft, locations = [], services = []) {
  const result = validationSource(draft, locations, services);
  return Array.isArray(result) ? result : [];
}
