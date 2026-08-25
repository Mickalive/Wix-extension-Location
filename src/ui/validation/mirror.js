/**
 * Validation mirror — the single seam between the dashboard UI and rule
 * validation semantics.
 *
 * The UI never imports a validator module directly; it asks the mirror.
 *
 * CONTRACT (extended in DASH-C3-1 for the F-N1 repoint, second half):
 *
 * `setValidationSource(source)` accepts exactly two source shapes:
 *
 * 1. FUNCTION SOURCE (original shape)
 *    `(draft, locations, services) => DraftIssue[]`
 *    Used for the bundled provisional validators and any callable validator.
 *
 * 2. SERVER VALIDATION RESULT (new, injected VERBATIM)
 *    `{ valid: boolean, issues: Array<{path: string, code: string, message: string}> }`
 *    This is the exact `ValidationResult` shape returned by the domain-side
 *    validation on PUT /ruleset (canonical `src/domain/validate.ts`:
 *    `ValidationIssue = {path, code, message}`). The mirror adapts it into a
 *    source function that returns the recorded issues verbatim — same codes,
 *    messages and paths, no rewriting — so once the platform wires that
 *    endpoint to the canonical validators, the dashboard can run on the exact
 *    server verdict instead of the provisional local mirror. This is the
 *    sanctioned first half of the F-N1 repoint whose parity proof is
 *    delivered from the domain side by RULES-C3-1.
 *
 * FALLBACK + FAIL-CLOSED RULES:
 *   - With NO configured source (default), the provisional bundled validators
 *     stay active so the editor works offline/pre-scaffold. Current behavior
 *     is unchanged when unconfigured.
 *   - Anything that is neither a function nor a structurally conforming
 *     server result is REJECTED (`setValidationSource` returns false) and the
 *     previously active source stays active: a bad integration can never
 *     silently disable validation.
 *   - A conforming server result is snapshotted (per-issue field copy) at
 *     injection time so later external mutation of the response object cannot
 *     retroactively change what the UI validated against.
 *   - `resetValidationSource()` always restores the bundled offline fallback.
 */

import { validateRuleDraft as bundledValidateRuleDraft } from './ruleDraftValidators.js';

let validationSource = bundledValidateRuleDraft;

/**
 * Structural check + snapshot of a server-shaped ValidationResult.
 * Returns an equivalent source function, or null when the value does not
 * conform (caller keeps the previous source — fail-closed).
 */
function adaptServerValidationResult(source) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  if (typeof source.valid !== 'boolean') return null;
  if (!Array.isArray(source.issues)) return null;
  const issues = [];
  for (const entry of source.issues) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    if (typeof entry.code !== 'string' || typeof entry.message !== 'string' || typeof entry.path !== 'string') {
      return null;
    }
    issues.push({ code: entry.code, message: entry.message, path: entry.path });
  }
  return () => issues;
}

/**
 * Replaces the validation source. Accepts either a function
 * `(draft, locations, services) => DraftIssue[]` or a server-shaped
 * `ValidationResult` object (`{valid, issues}`) injected verbatim.
 *
 * Guarded: any non-conforming argument is ignored (returns false) so a bad
 * integration cannot silently disable validation (fail-closed posture).
 *
 * @param {Function|{valid: boolean, issues: Array<{path: string, code: string, message: string}>}} source
 * @returns {boolean} true when the source was accepted.
 */
export function setValidationSource(source) {
  if (typeof source === 'function') {
    validationSource = source;
    return true;
  }
  const adapted = adaptServerValidationResult(source);
  if (!adapted) return false;
  validationSource = adapted;
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
