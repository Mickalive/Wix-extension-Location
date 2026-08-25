/**
 * Paging driver: drains {@link BillingPagingAdapter}s and feeds the pure
 * counting core. This is the exact handoff surface the Integration lane will
 * back with paginated Wix `listLocations` / `queryServices` adapters
 * (audit CYCLE_32692407760_BILLING.md finding F1).
 *
 * F1 repair note: `collectAllPages()` returns a `{ pages, pageCount }`
 * wrapper per source; the PURE CORE must receive the `.pages` arrays, never
 * the wrapper objects (passing wrappers crashed every invocation with
 * `TypeError: locationPages is not iterable` and failed strict tsc).
 *
 * Error semantics follow the port contract (`./ports`): adapter transport
 * errors propagate unchanged (fail-open posture upstream); only runaway
 * pagination — more than `MAX_PAGES_PER_SOURCE` pages from one source — is
 * converted into a {@link BillingPagingError} here.
 */

import {
  BillingPagingError,
  LOCATIONS_PAGE_LIMIT,
  MAX_PAGES_PER_SOURCE,
  SERVICES_PAGE_LIMIT,
} from './ports';
import type { BillingPagingAdapter, CollectedPages } from './ports';
import { countBillableLocations } from './countBillableLocations';
import type {
  BillableLocationCandidate,
  BillableServiceCandidate,
} from './countBillableLocations';
import type { BillableCountResult } from '../types';

/**
 * Drain one paging source to completion.
 *
 * Termination: a source is exhausted when `fetchPage` returns `null`
 * (genuinely no more data — see the port docstring) OR a page with zero
 * items. Anything else keeps paging until the runaway guard trips.
 */
export async function collectAllPages<T>(
  adapter: BillingPagingAdapter<T>,
  options: { sourceLabel: string; pageLimit: number },
): Promise<CollectedPages<T>> {
  const pages: CollectedPages<T>['pages'] = [];
  let offset = 0;
  let pageCount = 0;
  for (;;) {
    if (pageCount >= MAX_PAGES_PER_SOURCE) {
      throw new BillingPagingError(
        options.sourceLabel,
        `exceeded MAX_PAGES_PER_SOURCE (${MAX_PAGES_PER_SOURCE} pages) without reporting end of data`,
      );
    }
    const page = await adapter.fetchPage(offset, options.pageLimit);
    pageCount += 1;
    if (page === null || page.items.length === 0) break;
    pages.push(page);
    offset += page.items.length;
  }
  return { pages, pageCount };
}

/**
 * Count billable locations from live paging adapters (locations paginated at
 * 50/page, services at 100/page — Contract §11 C5). Both sources drain in
 * parallel; each page fetch goes through exactly one adapter call.
 */
export async function countFromAdapters(
  locations: BillingPagingAdapter<BillableLocationCandidate>,
  services: BillingPagingAdapter<BillableServiceCandidate>,
): Promise<BillableCountResult> {
  const [locationCollected, serviceCollected] = await Promise.all([
    collectAllPages(locations, { sourceLabel: 'locations', pageLimit: LOCATIONS_PAGE_LIMIT }),
    collectAllPages(services, { sourceLabel: 'services', pageLimit: SERVICES_PAGE_LIMIT }),
  ]);
  // F1 fix: pass the drained page ARRAYS (.pages), not the wrapper objects.
  return countBillableLocations(locationCollected.pages, serviceCollected.pages);
}
