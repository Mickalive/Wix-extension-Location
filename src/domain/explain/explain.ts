/**
 * Explainable outcomes (Contract §10 #10, Blueprint §5).
 *
 * Every decision — allow AND block — carries {ruleId, code, customerMessage}.
 * customerMessage is jargon-free, is displayed verbatim to customers by the
 * Wix validation plugin, and NEVER embeds internal identifiers
 * (ruleSetId/limitId/exceptionId/locationId/serviceId values).
 */

import type { Explanation } from '../../shared/types';

/** Engine rule families used as Explanation.ruleId. */
export const ENGINE_RULE_IDS = {
  ruleSet: 'ruleset',
  entitlement: 'entitlement',
  weeklyWindows: 'weekly-windows',
  exceptions: 'exceptions',
  limits: 'limits',
  duplicates: 'duplicates',
} as const;

/** Machine-readable outcome codes (stable contract for dashboards/tests). */
export const OUTCOME_CODES = {
  bookingAllowed: 'BOOKING_ALLOWED',
  invalidSlot: 'INVALID_SLOT',
  rulesetInvalid: 'RULESET_INVALID',
  evaluationError: 'EVALUATION_ERROR',
  locationNotCovered: 'LOCATION_NOT_COVERED',
  entitlementDegradedFailOpen: 'ENTITLEMENT_DEGRADED_FAIL_OPEN',
  outsideBookingHours: 'OUTSIDE_BOOKING_HOURS',
  dateClosed: 'DATE_CLOSED',
  quotaExceeded: 'QUOTA_EXCEEDED',
  countUnavailableFailOpen: 'COUNT_UNAVAILABLE_FAIL_OPEN',
  duplicateBooking: 'DUPLICATE_BOOKING',
  identityTimeConflict: 'IDENTITY_TIME_CONFLICT',
} as const;

export function explanation(
  decision: 'allow' | 'block',
  ruleId: string,
  code: string,
  customerMessage: string,
): Explanation {
  return { decision, ruleId, code, customerMessage };
}

export function allowExplanation(): Explanation {
  return explanation(
    'allow',
    ENGINE_RULE_IDS.ruleSet,
    OUTCOME_CODES.bookingAllowed,
    'This booking meets all active booking rules.',
  );
}

/** Non-blocking informational outcome (fail-open posture made visible). */
export function failOpenNotice(ruleId: string, code: string, customerMessage: string): Explanation {
  return explanation('allow', ruleId, code, customerMessage);
}
