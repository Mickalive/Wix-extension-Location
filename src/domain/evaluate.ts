/**
 * Pure rule evaluation: the single decision function of the rules domain.
 *
 * Deterministic and synchronous — the platform layer pre-resolves counts,
 * entitlement and the existing-booking snapshot (cached for the validation
 * plugin's tight timeout budget, Contract §5.3) and passes them in via
 * {@link EvaluationDeps}. Same inputs ⇒ same outcome, always.
 *
 * Stages (violations ACCUMULATE so one rejection explains every reason):
 *   0. fail-closed classification (RULESET_INVALID / INVALID_SLOT /
 *      EVALUATION_ERROR) — never throws;
 *   1. entitlement coverage (fail-open when billing signals are degraded);
 *   2. exceptions + weekly windows (site-zone wall clock, §4.7);
 *   3. caps per day/service/location with declared statuses;
 *   4. duplicate protection (identity-free first, C1).
 *
 * B4 REPAIR (audit CYCLE_32692407760_RULES): stage 2 no longer rejects a slot
 * merely because its end lands on the next calendar day. resolveSlot
 * normalizes an end exactly at local midnight to endMinute=1440, which fits a
 * window ending at the exclusive day boundary; only genuine overnight spans
 * (crossesMidnight) are blocked as `overnight_slot`.
 */

import { validateRuleSet } from './validate';
import { resolveSlot, parseInstantMillis } from './time/wallClock';
import type { ResolvedSlot } from './time/wallClock';
import { effectiveWeeklyWindows } from './windows/weeklyWindows';
import { resolveDayExceptions } from './exceptions/exceptions';
import { applicableLimits, countQueryForLimit } from './limits/limits';
import { findDuplicateConflict } from './duplicates/duplicates';
import type { ExistingBookingFact } from './duplicates/duplicates';
import {
  allowExplanation,
  explanation,
  ENGINE_RULE_IDS,
  OUTCOME_CODES,
} from './explain/explain';
import { weekdayOfDate } from './model/primitives';
import type { MinuteWindow } from './model/primitives';
import type {
  BookingFacts,
  CountQuery,
  Explanation,
  PolicyDecision,
  RuleOutcome,
} from '../shared/types';
import type { RuleSet } from './ports';

/**
 * Pre-resolved evaluation dependencies. `countForQuery` returns null when the
 * counter is unavailable (platform adapter maps infrastructure failures to
 * null): caps then degrade fail-open WITH a visible notice — never silently
 * and never by throwing (Blueprint §4 flow 4).
 */
export interface EvaluationDeps {
  entitlement: PolicyDecision;
  countForQuery(query: CountQuery): number | null;
  existingBookings(): readonly ExistingBookingFact[];
}

const MAX_SLOT_DURATION_MS = 24 * 60 * 60 * 1000;

interface SlotResolution {
  ok: true;
  resolved: ResolvedSlot;
  startMs: number;
  endMs: number;
}
interface SlotRejection {
  ok: false;
}

function tryResolveSlot(facts: BookingFacts): SlotResolution | SlotRejection {
  if (facts.slotStart === undefined || facts.slotEnd === undefined) return { ok: false };
  let startMs: number;
  let endMs: number;
  let resolved: ResolvedSlot;
  try {
    startMs = parseInstantMillis(facts.slotStart);
    endMs = parseInstantMillis(facts.slotEnd);
    if (!(endMs > startMs)) return { ok: false };
    if (endMs - startMs > MAX_SLOT_DURATION_MS) return { ok: false };
    resolved = resolveSlot(facts.slotStart, facts.slotEnd, facts.timezone);
  } catch {
    return { ok: false };
  }
  return { ok: true, resolved, startMs, endMs };
}

function outsideHoursMessage(reason: string): string {
  if (reason === 'overnight_slot') {
    return 'Bookings cannot span past closing time. Please choose a time that ends the same day.';
  }
  if (reason === 'closed') {
    return 'This date is not open for booking.';
  }
  return 'The selected time is outside opening hours. Please choose another time.';
}

/**
 * Evaluate one proposed booking against the active RuleSet.
 * Never throws: any internal failure classifies as EVALUATION_ERROR and blocks
 * (fail-closed), per Blueprint §5.
 */
export function evaluateRules(
  facts: BookingFacts,
  rules: RuleSet,
  deps: EvaluationDeps,
): RuleOutcome {
  try {
    const validation = validateRuleSet(rules);
    if (!validation.valid) {
      return {
        decision: 'block',
        explanations: [
          explanation(
            'block',
            ENGINE_RULE_IDS.ruleSet,
            OUTCOME_CODES.rulesetInvalid,
            'Booking rules are temporarily unavailable. Please try again shortly.',
          ),
        ],
      };
    }

    const explanations: Explanation[] = [];

    // Stage 1 — entitlement coverage (fail-open on degraded billing signals).
    if (deps.entitlement.degraded) {
      explanations.push(
        explanation(
          'allow',
          ENGINE_RULE_IDS.entitlement,
          OUTCOME_CODES.entitlementDegradedFailOpen,
          'Location coverage could not be verified and was allowed as a precaution.',
        ),
      );
    } else if (
      facts.locationId !== null &&
      facts.locationId !== undefined &&
      !deps.entitlement.allowedLocationIds.includes(facts.locationId)
    ) {
      explanations.push(
        explanation(
          'block',
          ENGINE_RULE_IDS.entitlement,
          OUTCOME_CODES.locationNotCovered,
          'Online booking is not available for this location.',
        ),
      );
    }
    // No locationId (CUSTOM/CUSTOMER location bookings arrive without one per
    // Contract §5.3) → nothing to check → non-blocking.

    // Stage 0b — slot shape.
    const slot = tryResolveSlot(facts);
    if (!slot.ok) {
      explanations.push(
        explanation(
          'block',
          ENGINE_RULE_IDS.ruleSet,
          OUTCOME_CODES.invalidSlot,
          'The selected time is not a valid booking slot.',
        ),
      );
    } else {
      const { targetDate, startMinute, endMinute, crossesMidnight } = slot.resolved;
      const weekday = weekdayOfDate(targetDate);

      // Stage 2 — exceptions, then weekly windows.
      const dayExceptions = resolveDayExceptions(rules, targetDate);
      let windows: MinuteWindow[] | null;
      let closedByException = false;
      if (dayExceptions.closed) {
        closedByException = true;
        windows = null;
      } else if (dayExceptions.overrideWindows !== null) {
        windows = dayExceptions.overrideWindows;
        if (windows.length === 0) closedByException = true;
      } else {
        windows = effectiveWeeklyWindows(rules, facts.serviceId, facts.locationId, weekday);
      }

      if (closedByException) {
        explanations.push(
          explanation(
            'block',
            ENGINE_RULE_IDS.exceptions,
            OUTCOME_CODES.dateClosed,
            outsideHoursMessage('closed'),
          ),
        );
      } else if (crossesMidnight) {
        // B4 REPAIR: genuine overnight spans stay blocked…
        explanations.push(
          explanation(
            'block',
            ENGINE_RULE_IDS.weeklyWindows,
            OUTCOME_CODES.outsideBookingHours,
            outsideHoursMessage('overnight_slot'),
          ),
        );
      } else if (windows !== null) {
        // …but a midnight-ending slot fits windows normally (endMinute==1440).
        const covered =
          windows.length > 0 &&
          windows.some(
            (w) => startMinute >= w.startMinute && endMinute <= w.endMinute && endMinute > startMinute,
          );
        if (!covered) {
          explanations.push(
            explanation(
              'block',
              ENGINE_RULE_IDS.weeklyWindows,
              OUTCOME_CODES.outsideBookingHours,
              outsideHoursMessage('outside_hours'),
            ),
          );
        }
      } // windows === null → weekly unconstrained (fresh-install default-open)

      // Stage 3 — caps.
      for (const limit of applicableLimits(rules, facts)) {
        const query = countQueryForLimit(limit, facts, targetDate, facts.timezone);
        let count: number | null;
        try {
          count = deps.countForQuery(query);
        } catch {
          count = null;
        }
        if (count === null) {
          explanations.push(
            explanation(
              'allow',
              ENGINE_RULE_IDS.limits,
              OUTCOME_CODES.countUnavailableFailOpen,
              'Availability counting is temporarily unavailable; the limit check was skipped.',
            ),
          );
        } else if (count >= limit.maxCount) {
          explanations.push(
            explanation(
              'block',
              ENGINE_RULE_IDS.limits,
              OUTCOME_CODES.quotaExceeded,
              'This time is fully booked. Please choose another time.',
            ),
          );
        }
      }

      // Stage 4 — duplicates (identity-free first).
      const conflict = findDuplicateConflict(
        {
          serviceId: facts.serviceId,
          slotStartMs: slot.startMs,
          slotEndMs: slot.endMs,
          targetDate,
          identityKey: facts.identityKey ?? null,
        },
        deps.existingBookings(),
        facts.timezone,
      );
      if (conflict === 'DUPLICATE_BOOKING') {
        explanations.push(
          explanation(
            'block',
            ENGINE_RULE_IDS.duplicates,
            OUTCOME_CODES.duplicateBooking,
            'You already have a booking that overlaps this time.',
          ),
        );
      } else if (conflict === 'IDENTITY_TIME_CONFLICT') {
        explanations.push(
          explanation(
            'block',
            ENGINE_RULE_IDS.duplicates,
            OUTCOME_CODES.identityTimeConflict,
            'This time overlaps another booking with the same details.',
          ),
        );
      }
    }

    if (explanations.length === 0) {
      return { decision: 'allow', explanations: [allowExplanation()] };
    }
    const decision = explanations.some((e) => e.decision === 'block') ? 'block' : 'allow';
    return { decision, explanations };
  } catch {
    return {
      decision: 'block',
      explanations: [
        explanation(
          'block',
          ENGINE_RULE_IDS.ruleSet,
          OUTCOME_CODES.evaluationError,
          'Booking could not be validated. Please try again shortly.',
        ),
      ],
    };
  }
}
