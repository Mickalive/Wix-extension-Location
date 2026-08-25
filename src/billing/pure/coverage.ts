/**
 * Pure over-limit coverage selection (Contract §7 "Over-limit behavior",
 * directives/BILLING.md downgrade safety).
 *
 * Stable ordering: the default location first, then alphabetical by location
 * id (byte-wise `<` comparison — locale-independent and deterministic).
 * Locations beyond the plan allowance are returned as `unmanagedLocationIds`:
 * their management is DISABLED, never deleted. Customer configuration is
 * preserved so an upgrade restores coverage without data loss.
 *
 * Purity: no I/O, no Wix imports; inputs are never mutated.
 */

import type { ManagedLocationRecord } from '../types';

export interface CoverageSelection {
  /** Location ids inside the plan allowance, in the stable managed order. */
  allowedLocationIds: string[];
  /** Managed locations beyond the allowance — management disabled, configuration preserved. */
  unmanagedLocationIds: string[];
  /** True when at least one managed location falls outside the allowance (upgrade CTA state). */
  overLimit: boolean;
}

/**
 * Select which managed locations fall inside a plan allowance.
 * `maxLocations` may be `Number.POSITIVE_INFINITY` for the unlimited tier.
 */
export function selectManagedLocations(
  locations: ReadonlyArray<ManagedLocationRecord>,
  maxLocations: number,
): CoverageSelection {
  // Defensive re-filter: archived locations are never managed, even if an
  // upstream adapter let one slip through.
  const live = locations.filter((record) => record.archived !== true);

  const ordered = [...live].sort((a, b) => {
    const aDefault = a.isDefault === true ? 0 : 1;
    const bDefault = b.isDefault === true ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    return compareLocationIds(a.locationId, b.locationId);
  });

  const allowedLocationIds: string[] = [];
  const unmanagedLocationIds: string[] = [];
  const seen = new Set<string>();
  for (const record of ordered) {
    if (seen.has(record.locationId)) continue; // dedupe defensively; first wins in stable order
    seen.add(record.locationId);
    if (allowedLocationIds.length < maxLocations) {
      allowedLocationIds.push(record.locationId);
    } else {
      unmanagedLocationIds.push(record.locationId);
    }
  }

  return {
    allowedLocationIds,
    unmanagedLocationIds,
    overLimit: unmanagedLocationIds.length > 0,
  };
}

function compareLocationIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
