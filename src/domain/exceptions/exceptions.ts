/**
 * Date-specific exceptions: closures, temporary overrides, precedence.
 *
 * Semantics (documented in src/domain/README.md):
 *  - Exceptions match by EXACT local date, so a bounded override (e.g. a
 *    single holiday) expires automatically the moment the date passes — no
 *    separate expiry machinery, and days before/after keep weekly behavior.
 *  - CLOSED beats OVERRIDE: if any closure exists for the date, the date is
 *    closed regardless of any override declared for the same date.
 *  - Same-tier override INTERSECTION: multiple overrides on one date intersect
 *    their window sets (intersections never accidentally expand availability).
 *    An OVERRIDE whose intersection is empty closes the date.
 */

import {
  intersectWindowSets,
  isValidMinuteWindow,
  normalizeWindows,
  parseLocalTime,
} from '../model/primitives';
import type { MinuteWindow } from '../model/primitives';
import type { RuleSet } from '../ports';

export interface DayExceptionResolution {
  /** A CLOSED exception exists for the date. */
  closed: boolean;
  /**
   * Override windows replacing the weekly schedule for this date; null when
   * no override applies. An empty array means "overridden to closed".
   */
  overrideWindows: MinuteWindow[] | null;
}

function overrideToWindows(windows: RuleSet['exceptions'][number]['windows']): MinuteWindow[] {
  const out: MinuteWindow[] = [];
  if (!windows) return out;
  for (const w of windows) {
    const start = parseLocalTime(w.start);
    const end = parseLocalTime(w.end);
    if (start === null || end === null) continue; // invalid configs rejected by validateRuleSet
    const candidate = { startMinute: start, endMinute: end };
    if (!isValidMinuteWindow(candidate)) continue;
    out.push(candidate);
  }
  return normalizeWindows(out);
}

/** Resolves all exceptions matching exactly `date`. */
export function resolveDayExceptions(rules: RuleSet, date: string): DayExceptionResolution {
  let closed = false;
  let accumulated: MinuteWindow[] | null = null;
  for (const exc of rules.exceptions) {
    if (exc.date !== date) continue;
    if (exc.kind === 'CLOSED') {
      closed = true; // CLOSED beats OVERRIDE — keep scanning only for diagnostics
      continue;
    }
    const own = overrideToWindows(exc.windows);
    accumulated = accumulated === null ? own : intersectWindowSets(accumulated, own);
  }
  if (closed) {
    return { closed: true, overrideWindows: null };
  }
  return { closed: false, overrideWindows: accumulated };
}
