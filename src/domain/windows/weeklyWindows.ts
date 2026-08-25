/**
 * Weekly window resolution: per-location and per-service schedules, split
 * daily windows, and the location ∩ service intersection.
 *
 * Semantics (documented in src/domain/README.md):
 *  - Windows are declared per weekday; a weekday may carry any number of
 *    windows (split hours, e.g. 09:00–12:00 + 14:00–18:00).
 *  - When BOTH a service and a location declare windows for the weekday, the
 *    effective availability is their INTERSECTION — never the union.
 *  - When only one source declares windows, that source alone applies.
 *  - If the RuleSet declares NO weekly windows anywhere, weekly evaluation is
 *    unconstrained (fresh-install default-open posture). As soon as any
 *    weekly configuration exists, the week is exhaustive: a weekday without
 *    windows for the relevant scope is closed.
 */

import {
  intersectWindowSets,
  isValidMinuteWindow,
  normalizeWindows,
  parseLocalTime,
} from '../model/primitives';
import type { MinuteWindow } from '../model/primitives';
import type { Weekday } from '../../shared/types';
import type { RuleSet } from '../ports';

function windowsForWeekday(
  map: Record<string, Array<{ weekday: Weekday; start: string; end: string }>> | undefined,
  key: string,
  weekday: Weekday,
): MinuteWindow[] {
  if (!map) return [];
  const list = map[key];
  if (!list) return [];
  const out: MinuteWindow[] = [];
  for (const w of list) {
    if (w.weekday !== weekday) continue;
    const start = parseLocalTime(w.start);
    const end = parseLocalTime(w.end);
    if (start === null || end === null) continue; // invalid configs are rejected by validateRuleSet
    const candidate = { startMinute: start, endMinute: end };
    if (!isValidMinuteWindow(candidate)) continue;
    out.push(candidate);
  }
  return normalizeWindows(out);
}

/** True when ANY weekly window is configured for ANY scope/weekday. */
export function hasAnyWeeklyConfiguration(rules: RuleSet): boolean {
  for (const list of Object.values(rules.locationWindows)) {
    if (list && list.length > 0) return true;
  }
  for (const list of Object.values(rules.serviceWindows)) {
    if (list && list.length > 0) return true;
  }
  return false;
}

/**
 * Effective weekly windows for a proposal scope on `weekday`.
 * Returns null when weekly evaluation is unconstrained (no weekly config at
 * all); returns [] when the week is configured but this weekday/scope is
 * closed.
 */
export function effectiveWeeklyWindows(
  rules: RuleSet,
  serviceId: string,
  locationId: string | null | undefined,
  weekday: Weekday,
): MinuteWindow[] | null {
  if (!hasAnyWeeklyConfiguration(rules)) return null;
  const service = windowsForWeekday(rules.serviceWindows, serviceId, weekday);
  const location = locationId
    ? windowsForWeekday(rules.locationWindows, locationId, weekday)
    : [];
  if (service.length > 0 && location.length > 0) {
    return intersectWindowSets(service, location);
  }
  if (service.length > 0) return service;
  if (location.length > 0) return location;
  return [];
}
