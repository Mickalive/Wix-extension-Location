/**
 * Pure billable-location counting core (Contract §7 ratified definition,
 * §11 C3/C5). Takes already-fetched pages as input — zero I/O, zero Wix
 * imports (Blueprint §1: thin Wix paging adapters live in the platform layer).
 *
 * Billable location (ratified): a business location L such that
 *   (1) L exists with `archived === false` (liveness is NEVER `status` —
 *       INACTIVE is unsupported and archiving does not change status), and
 *   (2) at least one counted service references L via
 *       `locations[type='BUSINESS'].business.id`.
 *
 * Counted-service policy v1: every NON-HIDDEN service counts, regardless of
 * `onlineBooking.enabled`. Distinct-set intersection prevents double counting
 * no matter how many services reference the same location. Per Invariant C3
 * the count is computed via this services cross-reference — never via
 * aggregate-only location fields.
 */

import type { FetchedPage } from './ports';
import type { BillableCountResult } from '../types';

/** Defensive structural input for one location row. */
export interface BillableLocationCandidate {
  locationId: string;
  archived?: boolean | null;
}

/** One `locations[]` entry of a service (Services V2 shape, narrowed). */
export interface BillableServiceLocationRef {
  type?: string | null;
  business?: { id?: string | null } | null;
}

/** Defensive structural input for one service row. */
export interface BillableServiceCandidate {
  hidden?: boolean | null;
  locations?: ReadonlyArray<BillableServiceLocationRef> | null;
}

/**
 * Count billable locations from fetched location/service pages.
 *
 * Floor semantics (Contract §7): a COMPUTED count of 0 is treated as 1 for
 * billing. The floor bumps only `count`; `billableLocationIds` stays the true
 * computed set (possibly empty) — it is a reporting set, not an entitlement
 * grant. The dashboard documents the floor to merchants.
 */
export function countBillableLocations(
  locationPages: ReadonlyArray<FetchedPage<BillableLocationCandidate>>,
  servicePages: ReadonlyArray<FetchedPage<BillableServiceCandidate>>,
): BillableCountResult {
  const liveLocationIds = new Set<string>();
  for (const page of locationPages) {
    for (const location of page.items) {
      if (!location) continue;
      if (typeof location.locationId !== 'string' || location.locationId.length === 0) continue;
      if (location.archived === true) continue; // liveness = archived=false (C5)
      liveLocationIds.add(location.locationId);
    }
  }

  const referenced = new Set<string>();
  for (const page of servicePages) {
    for (const service of page.items) {
      if (!service) continue;
      if (service.hidden === true) continue; // policy v1: non-hidden services only
      const refs = service.locations ?? [];
      for (const ref of refs) {
        if (!ref || ref.type !== 'BUSINESS') continue;
        const id = ref.business?.id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (liveLocationIds.has(id)) referenced.add(id);
      }
    }
  }

  const billableLocationIds = [...referenced].sort(compareLocationIds);
  const computed = billableLocationIds.length;
  return { count: computed === 0 ? 1 : computed, billableLocationIds };
}

function compareLocationIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
