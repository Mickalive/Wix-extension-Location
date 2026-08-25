/**
 * Billing paging port — the seam the Integration lane backs with paginated
 * Wix `listLocations` / `queryServices` calls (Contract §5.1, §11 C5:
 * paginate BOTH sources; locations default page 50, services page 100).
 *
 * ADAPTER ERROR SEMANTICS — binding handoff to the Integration lane
 * (audit CYCLE_32692407760_BILLING.md, non-blocking observation 1):
 *
 * 1. An adapter MUST THROW on infrastructure failure: network error, timeout,
 *    5xx, authentication/token problem, malformed payload. Throwing is how an
 *    adapter says "the true state is UNKNOWN". The billing layer converts a
 *    thrown error into the contracted fail-open + persistent-warning posture;
 *    it never converts it into data.
 * 2. An adapter MUST return `null` ONLY when Wix genuinely reports no (more)
 *    billing data for this source — a definitive end-of-list. Returning
 *    `null` asserts "the trustworthy answer is: nothing here" and is treated
 *    as a reliable empty snapshot.
 * 3. Swallowing a transport error and returning `null` instead would make a
 *    paying merchant silently look FREE/restricted (the exact hazard audit
 *    observation 1 flags). Never do that — throw.
 *
 * Purity: this port is Wix-import-free; adapters live in the platform layer.
 */

/** One fetched page of items from a paginated source. */
export interface FetchedPage<T> {
  items: T[];
}

/**
 * A paging adapter over one Wix list source. `offset` is the number of items
 * already consumed; `limit` is the contracted page size for that source
 * (`LOCATIONS_PAGE_LIMIT` / `SERVICES_PAGE_LIMIT`). See the module docstring
 * for the binding throw-vs-null semantics.
 */
export interface BillingPagingAdapter<T> {
  fetchPage(offset: number, limit: number): Promise<FetchedPage<T> | null>;
}

/** Contract §11 C5: locations paginate with the SDK default limit 50. */
export const LOCATIONS_PAGE_LIMIT = 50;

/** Contract §11 C5: services paginate with page size 100. */
export const SERVICES_PAGE_LIMIT = 100;

/**
 * Liveness guard against adapters that never report end-of-data. Draining
 * more than this many pages from ONE source is treated as an infrastructure
 * fault (runaway pagination) and throws {@link BillingPagingError}.
 */
export const MAX_PAGES_PER_SOURCE = 10_000;

/** Raised by the paging driver on runaway pagination; adapter transport errors propagate unchanged. */
export class BillingPagingError extends Error {
  readonly source: string;

  constructor(source: string, message: string) {
    super(`Billing paging adapter '${source}' ${message}`);
    this.name = 'BillingPagingError';
    this.source = source;
  }
}

/** Everything drained from one source, in order. */
export interface CollectedPages<T> {
  pages: FetchedPage<T>[];
  pageCount: number;
}
