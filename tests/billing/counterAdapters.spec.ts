/**
 * Paging-driver tests over fake adapters (BILL-C2-1-REPAIR).
 *
 * Regression proof for audit findings F1 (wrapper-object crash),
 * F2 (impossible 130-vs-123 assertion — pinned to the provable 123 with a
 * full derivation), F3 (runaway fixture now counts calls inside fetchPage)
 * and F4 (BillingPagingAdapter type import). Also proves the port's
 * throw-vs-null semantics: infrastructure failures propagate, genuine
 * end-of-data terminates cleanly.
 */
import { describe, expect, it } from 'vitest';
import { countFromAdapters } from '../../src/billing/counter/countFromAdapters';
import { BillingPagingError, MAX_PAGES_PER_SOURCE } from '../../src/billing/counter/ports';
import type { BillingPagingAdapter, FetchedPage } from '../../src/billing/counter/ports';
import type {
  BillableLocationCandidate,
  BillableServiceCandidate,
  BillableServiceLocationRef,
} from '../../src/billing/counter/countBillableLocations';

function businessRef(locationId: string): BillableServiceLocationRef {
  return { type: 'BUSINESS', business: { id: locationId } };
}

function locationCandidate(id: string): BillableLocationCandidate {
  return { locationId: id, archived: false };
}

function serviceCandidate(...refs: BillableServiceLocationRef[]): BillableServiceCandidate {
  return { hidden: false, locations: refs };
}

/** Fixed-page-size adapter over an in-memory array; counts every fetch call. */
function pagedAdapter<T>(
  items: readonly T[],
  pageSize: number,
): BillingPagingAdapter<T> & { calls(): number } {
  let calls = 0;
  return {
    async fetchPage(offset: number): Promise<FetchedPage<T> | null> {
      calls += 1;
      const slice = items.slice(offset, offset + pageSize);
      return slice.length === 0 ? null : { items: slice };
    },
    calls(): number {
      return calls;
    },
  };
}

/** Adapter that always reports end-of-data on the first call. */
function absentAdapter<T>(): BillingPagingAdapter<T> & { calls(): number } {
  let calls = 0;
  return {
    async fetchPage(): Promise<FetchedPage<T> | null> {
      calls += 1;
      return null;
    },
    calls(): number {
      return calls;
    },
  };
}

describe('countFromAdapters (paging driver)', () => {
  it('drains multi-page location and service adapters and returns the correct billable count (F1 crash repro)', async () => {
    // 120 locations at pageSize 50 ⇒ pages 50/50/20 (+1 terminating call);
    // 150 services at pageSize 100 ⇒ pages 100/50 (+1 terminating call).
    const locIds = Array.from({ length: 120 }, (_, i) => `loc-${String(i).padStart(3, '0')}`);
    const services = Array.from({ length: 150 }, (_, i) =>
      serviceCandidate(businessRef(`loc-${String(i % 45).padStart(3, '0')}`)),
    );

    const locations = pagedAdapter<BillableLocationCandidate>(
      locIds.map(locationCandidate),
      50,
    );
    const serviceSource = pagedAdapter<BillableServiceCandidate>(services, 100);

    const result = await countFromAdapters(locations, serviceSource);

    expect(result.count).toBe(45);
    expect(result.billableLocationIds).toHaveLength(45);
    expect(locations.calls()).toBe(4); // 3 data pages + end-of-data probe
    expect(serviceSource.calls()).toBe(3); // 2 data pages + end-of-data probe
  });

  it('handles empty first pages gracefully: terminates immediately and applies the floor', async () => {
    function emptyPageAdapter<T>(): BillingPagingAdapter<T> & { calls(): number } {
      let calls = 0;
      return {
        async fetchPage(): Promise<FetchedPage<T> | null> {
          calls += 1;
          return { items: [] }; // an existing-but-empty page terminates draining
        },
        calls(): number {
          return calls;
        },
      };
    }

    const locations = emptyPageAdapter<BillableLocationCandidate>();
    const services = emptyPageAdapter<BillableServiceCandidate>();

    const result = await countFromAdapters(locations, services);

    expect(result.count).toBe(1); // computed 0 ⇒ single-location floor
    expect(result.billableLocationIds).toEqual([]);
    expect(locations.calls()).toBe(1);
    expect(services.calls()).toBe(1);
  });

  it('modulo-pattern fixture covers exactly its 123 provably distinct ids (F2 regression pin)', async () => {
    // Fixture (identical in shape to the audited cycle-1 candidate):
    //   130 live locations loc-000..loc-129; three counted-service groups
    //   reference location indices A = {i : 0 ≤ i < 100},
    //   B = {(7i) mod 130 : 0 ≤ i < 100}, C = {(11i) mod 130 : 0 ≤ i < 30}.
    //
    // |A|=100; |B|=100 (7 invertible mod 130, i<100 within one period of 130);
    // |C|=30 (11 invertible mod 130). Inclusion–exclusion over the union:
    //   |A∩B| = #{i<100 : (7i mod 130) < 100} = 78
    //   |A∩C| = #{i<30 : (11i mod 130) < 100} = 25
    //   |B∩C| = #{j<30 : (113j mod 130) < 100} = 23   (113 ≡ 7⁻¹·11 mod 130)
    //   |A∩B∩C| = 19
    //   |A∪B∪C| = 100+100+30 −78−25−23 +19 = 123
    // The cycle-1 test hardcoded 130 here while the fixture provably covers
    // only these 123 distinct ids — the pin below asserts the derived truth.
    const locIds = Array.from({ length: 130 }, (_, i) => `loc-${String(i).padStart(3, '0')}`);
    const referencedIndices = new Set<number>();
    for (let i = 0; i < 100; i += 1) referencedIndices.add(i);
    for (let i = 0; i < 100; i += 1) referencedIndices.add((7 * i) % 130);
    for (let i = 0; i < 30; i += 1) referencedIndices.add((11 * i) % 130);

    const groupA = Array.from({ length: 100 }, (_, i) =>
      serviceCandidate(businessRef(`loc-${String(i).padStart(3, '0')}`)),
    );
    const groupB = Array.from({ length: 100 }, (_, i) =>
      serviceCandidate(businessRef(`loc-${String((7 * i) % 130).padStart(3, '0')}`)),
    );
    const groupC = Array.from({ length: 30 }, (_, i) =>
      serviceCandidate(businessRef(`loc-${String((11 * i) % 130).padStart(3, '0')}`)),
    );

    const expectedIds = [...referencedIndices]
      .map((index) => `loc-${String(index).padStart(3, '0')}`)
      .sort();
    expect(expectedIds).toHaveLength(123); // derivation pin — fails loudly if the math above slips

    const result = await countFromAdapters(
      pagedAdapter<BillableLocationCandidate>(locIds.map(locationCandidate), 50),
      pagedAdapter<BillableServiceCandidate>([...groupA, ...groupB, ...groupC], 100),
    );

    expect(result.count).toBe(123);
    expect(result.billableLocationIds).toEqual(expectedIds);
  });

  it('runaway adapter guard rejects after exactly MAX_PAGES_PER_SOURCE real fetch calls (F3 regression)', async () => {
    // F3 repair: the counter is incremented INSIDE fetchPage so the assertion
    // observes the adapter the driver actually drove.
    function runawayAdapter(): BillingPagingAdapter<BillableLocationCandidate> & {
      calls: number;
    } {
      const fixture = {
        calls: 0,
        async fetchPage(): Promise<FetchedPage<BillableLocationCandidate>> {
          fixture.calls += 1;
          return { items: [locationCandidate(`runaway-${fixture.calls}`)] };
        },
      };
      return fixture;
    }

    const runaway = runawayAdapter();

    await expect(
      countFromAdapters(runaway, absentAdapter<BillableServiceCandidate>()),
    ).rejects.toBeInstanceOf(BillingPagingError);

    expect(runaway.calls).toBe(MAX_PAGES_PER_SOURCE);
  });

  it('propagates adapter infrastructure failures instead of swallowing them into a null snapshot', async () => {
    // Port contract (counter/ports.ts): adapters MUST throw on infrastructure
    // failure; the driver must forward that throw unchanged so upstream can
    // apply the fail-open posture. Converting the error into `null` would
    // fabricate a trustworthy-looking "no billing data" snapshot.
    const boom = new Error('transport down');
    const failingLocations = {
      async fetchPage(): Promise<FetchedPage<BillableLocationCandidate> | null> {
        throw boom;
      },
    };

    await expect(
      countFromAdapters(failingLocations, absentAdapter<BillableServiceCandidate>()),
    ).rejects.toBe(boom);
  });

  it('null on the very first page terminates with exactly one call per source and the floor count', async () => {
    const locations = absentAdapter<BillableLocationCandidate>();
    const services = absentAdapter<BillableServiceCandidate>();

    const result = await countFromAdapters(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual([]);
    expect(locations.calls()).toBe(1);
    expect(services.calls()).toBe(1);
  });
});
