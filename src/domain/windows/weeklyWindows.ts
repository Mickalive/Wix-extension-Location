/**
 * Weekly window resolution: per-location and per-service schedules, split
 * daily windows, and the location ∩ service intersection.
 *
 * Semantics:
 *  - Windows are declared per weekday; a weekday may carry any number of
 *    windows (split hours, e.g. 09:00–12:00 + 14:00–18:00).
 *  - A configured SERVICE schedule is exhaustive for that service only: an
 *    omitted weekday closes that service, but must not close unrelated ones.
 *  - A configured LOCATION schedule is exhaustive for that location only.
 *  - When BOTH the relevant service and location are configured, effective
 *    availability is their INTERSECTION — never the union.
 *  - If neither relevant scope is configured, weekly evaluation is
 *    unconstrained (fresh-install/default-Wix posture).
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

type WeeklyMap = Record<string, Array<{ weekday: Weekday; start: string; end: string }>>;

function windowsForWeekday(
  map: WeeklyMap | undefined,
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

function scopeConfigured(map: WeeklyMap | undefined, key: string | null | undefined): boolean {
  if (!map || !key) return false;
  const rows = map[key];
  return Array.isArray(rows) && rows.length > 0;
}

/** True when ANY weekly window is configured anywhere in the RuleSet. */
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
 * Returns null when neither the proposed service nor its location has a
 * weekly schedule; returns [] when a relevant configured scope omits this
 * weekday (closed for that scope).
 */
export function effectiveWeeklyWindows(
  rules: RuleSet,
  serviceId: string,
  locationId: string | null | undefined,
  weekday: Weekday,
): MinuteWindow[] | null {
  const serviceConfigured = scopeConfigured(rules.serviceWindows, serviceId);
  const locationConfigured = scopeConfigured(rules.locationWindows, locationId);

  if (!serviceConfigured && !locationConfigured) return null;

  const service = serviceConfigured
    ? windowsForWeekday(rules.serviceWindows, serviceId, weekday)
    : null;
  const location = locationConfigured && locationId
    ? windowsForWeekday(rules.locationWindows, locationId, weekday)
    : null;

  // If a configured scope omits the weekday, that scope is closed; when both
  // scopes apply the intersection is therefore empty as well.
  if (serviceConfigured && service?.length === 0) return [];
  if (locationConfigured && location?.length === 0) return [];

  if (service && location) return intersectWindowSets(service, location);
  if (service) return service;
  if (location) return location;
  return [];
}
