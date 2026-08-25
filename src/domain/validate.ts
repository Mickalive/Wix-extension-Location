/**
 * RuleSet structural validation — the same validator the dashboard mirrors
 * (Blueprint §6 "validation-mirror") and the evaluator runs fail-closed
 * before trusting any configuration.
 *
 * A3 REPAIR (audit CYCLE_32692407760_RULES): RESERVED_RULE_IDS is IMPORTED
 * from model/primitives instead of a hardcoded local copy, eliminating the
 * drift risk the audit flagged.
 */

import { RESERVED_RULE_IDS, isReservedRuleId } from './model/primitives';
import {
  assertValidLocalDate,
  isValidMinuteWindow,
  isValidWindowStartMinute,
  parseLocalTime,
  WEEKDAYS,
} from './model/primitives';
import type { RuleSet } from './ports';
import type { BookingStatus, WeeklyWindowDTO } from '../shared/types';

export interface ValidationIssue {
  /** Dotted path to the offending value, e.g. `limits[0].maxCount`. */
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const BOOKING_STATUSES: readonly BookingStatus[] = [
  'CREATED',
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'WAITING_LIST',
  'UPDATED',
  'CANCELED',
];

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function validateWindowList(
  path: string,
  windows: readonly WeeklyWindowDTO[],
  out: ValidationIssue[],
): void {
  windows.forEach((w, index) => {
    const at = `${path}[${index}]`;
    if (!WEEKDAYS.includes(w.weekday)) {
      out.push(issue(`${at}.weekday`, 'INVALID_WEEKDAY', `Unknown weekday ${JSON.stringify(w.weekday)}.`));
    }
    const start = typeof w.start === 'string' ? parseLocalTime(w.start) : null;
    const end = typeof w.end === 'string' ? parseLocalTime(w.end) : null;
    if (start === null) {
      out.push(issue(`${at}.start`, 'INVALID_TIME', 'Start must be HH:mm (00:00–23:59).'));
    }
    if (end === null) {
      out.push(issue(`${at}.end`, 'INVALID_TIME', 'End must be HH:mm (00:00–23:59 or exclusive 24:00).'));
    }
    if (start !== null && end !== null) {
      // "24:00" (1440) is legal only as an exclusive END; starts must be real
      // wall minutes.
      if (!isValidWindowStartMinute(start)) {
        out.push(issue(`${at}.start`, 'INVALID_TIME', 'Start must be a real wall-clock minute (24:00 is only a valid end).'));
      }
      if (!isValidMinuteWindow({ startMinute: start, endMinute: end })) {
        out.push(issue(at, 'INVALID_WINDOW', 'End must be strictly after start.'));
      }
    }
  });
}

/**
 * Validates a full RuleSet. Pure and total: never throws for shape-mismatched
 * input, reports everything it can in one pass.
 */
export function validateRuleSet(rules: RuleSet): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (typeof rules.ruleSetId !== 'string' || rules.ruleSetId.length === 0) {
    issues.push(issue('ruleSetId', 'MISSING_FIELD', 'Rule set id is required.'));
  }
  if (typeof rules.revision !== 'string' || rules.revision.length === 0) {
    issues.push(issue('revision', 'MISSING_FIELD', 'Revision is required.'));
  }
  if (!Number.isInteger(rules.version) || rules.version < 1) {
    issues.push(issue('version', 'INVALID_VALUE', 'Version must be a positive integer.'));
  }

  for (const [mapName, map] of [
    ['locationWindows', rules.locationWindows],
    ['serviceWindows', rules.serviceWindows],
  ] as const) {
    for (const [key, list] of Object.entries(map ?? {})) {
      if (!Array.isArray(list)) {
        issues.push(issue(`${mapName}.${key}`, 'INVALID_VALUE', 'Window list must be an array.'));
        continue;
      }
      validateWindowList(`${mapName}.${key}`, list, issues);
    }
  }

  const seenExceptionIds = new Set<string>();
  rules.exceptions.forEach((exc, index) => {
    const at = `exceptions[${index}]`;
    if (typeof exc.exceptionId !== 'string' || exc.exceptionId.length === 0) {
      issues.push(issue(`${at}.exceptionId`, 'MISSING_FIELD', 'Exception id is required.'));
    } else {
      if (seenExceptionIds.has(exc.exceptionId)) {
        issues.push(issue(`${at}.exceptionId`, 'DUPLICATE_ID', 'Exception ids must be unique.'));
      }
      seenExceptionIds.add(exc.exceptionId);
      if (isReservedRuleId(exc.exceptionId)) {
        issues.push(
          issue(
            `${at}.exceptionId`,
            'RESERVED_ID',
            `Exception id must not use a reserved rule id (${RESERVED_RULE_IDS.join(', ')}).`,
          ),
        );
      }
    }
    try {
      assertValidLocalDate(exc.date);
    } catch {
      issues.push(issue(`${at}.date`, 'INVALID_VALUE', 'Exception date must be a real YYYY-MM-DD date.'));
    }
    if (exc.kind !== 'CLOSED' && exc.kind !== 'OVERRIDE') {
      issues.push(issue(`${at}.kind`, 'INVALID_VALUE', 'Kind must be CLOSED or OVERRIDE.'));
    }
    if (exc.kind === 'OVERRIDE') {
      if (!Array.isArray(exc.windows) || exc.windows.length === 0) {
        issues.push(issue(`${at}.windows`, 'INVALID_EXCEPTION', 'An OVERRIDE requires at least one window (use CLOSED to close a date).'));
      } else {
        validateWindowList(`${at}.windows`, exc.windows, issues);
      }
    }
  });

  const seenLimitIds = new Set<string>();
  rules.limits.forEach((limit, index) => {
    const at = `limits[${index}]`;
    if (typeof limit.limitId !== 'string' || limit.limitId.length === 0) {
      issues.push(issue(`${at}.limitId`, 'MISSING_FIELD', 'Limit id is required.'));
    } else {
      if (seenLimitIds.has(limit.limitId)) {
        issues.push(issue(`${at}.limitId`, 'DUPLICATE_ID', 'Limit ids must be unique.'));
      }
      seenLimitIds.add(limit.limitId);
      if (isReservedRuleId(limit.limitId)) {
        issues.push(
          issue(
            `${at}.limitId`,
            'RESERVED_ID',
            `Limit id must not use a reserved rule id (${RESERVED_RULE_IDS.join(', ')}).`,
          ),
        );
      }
    }
    if (limit.dimension !== 'DAY' && limit.dimension !== 'SERVICE' && limit.dimension !== 'LOCATION') {
      issues.push(issue(`${at}.dimension`, 'INVALID_VALUE', 'Dimension must be DAY, SERVICE or LOCATION.'));
    }
    if ((limit.dimension === 'SERVICE' || limit.dimension === 'LOCATION') &&
      (typeof limit.targetId !== 'string' || limit.targetId.length === 0)) {
      issues.push(issue(`${at}.targetId`, 'MISSING_FIELD', `A ${limit.dimension} limit requires targetId.`));
    }
    if (!Number.isInteger(limit.maxCount) || limit.maxCount < 1) {
      issues.push(issue(`${at}.maxCount`, 'INVALID_VALUE', 'maxCount must be an integer of at least 1.'));
    }
    if (
      !Array.isArray(limit.includedStatuses) ||
      limit.includedStatuses.length === 0 ||
      !limit.includedStatuses.every((s) => BOOKING_STATUSES.includes(s))
    ) {
      issues.push(issue(`${at}.includedStatuses`, 'INVALID_VALUE', 'includedStatuses must be a non-empty list of booking statuses.'));
    }
  });

  return { valid: issues.length === 0, issues };
}
