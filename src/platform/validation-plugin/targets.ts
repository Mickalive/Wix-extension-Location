/**
 * Validation-plugin targets and their binding failure semantics
 * (INT-C3-1 item c; Technical Contract §5.3; Blueprint §4 flow 1 / §5).
 *
 * BINDING PLATFORM FACTS (Contract §5.3, verbatim semantics):
 * - Fail-CLOSED on internal error/timeout: CREATE and CANCEL (and their
 *   *_MULTI_SERVICE variants). A booking that cannot be validated must not
 *   happen: the handler returns an explicit block-with-retry-hint per item.
 * - Fail-OPEN forever: RESCHEDULE (+ multi-service). Reschedule guarantees are
 *   best-effort ONLY — on internal error/timeout the handler returns explicit
 *   valid results, records a logged/alerted degradation, and NEVER claims
 *   enforcement (`enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'`).
 *
 * The shared taxonomy helper `failureSemanticsFor` (src/shared/errors.ts) is
 * the single source of this mapping; it is re-derived here only to attach the
 * per-target documentation. Any drift fails the handler-matrix tests.
 */

import { failureSemanticsFor } from '../../shared/errors';
import type { FailureSemantics } from '../../shared/errors';

export type ValidationTarget =
  | 'CREATE'
  | 'CREATE_MULTI_SERVICE'
  | 'CANCEL'
  | 'CANCEL_MULTI_SERVICE'
  | 'RESCHEDULE'
  | 'RESCHEDULE_MULTI_SERVICE';

export const VALIDATION_TARGETS: readonly ValidationTarget[] = [
  'CREATE',
  'CREATE_MULTI_SERVICE',
  'CANCEL',
  'CANCEL_MULTI_SERVICE',
  'RESCHEDULE',
  'RESCHEDULE_MULTI_SERVICE',
];

export function isValidationTarget(value: unknown): value is ValidationTarget {
  return (
    typeof value === 'string' &&
    (VALIDATION_TARGETS as readonly string[]).includes(value)
  );
}

/** Binding per-target failure semantics (Contract §5.3). */
export function semanticsOf(target: ValidationTarget): FailureSemantics {
  return failureSemanticsFor(target.replace('_MULTI_SERVICE', '') as 'CREATE' | 'CANCEL' | 'RESCHEDULE');
}
