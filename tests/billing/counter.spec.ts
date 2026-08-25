/**
 * Pure billable-location counting core (BILL-C2-1-REPAIR; Contract §7, §11 C3/C5).
 *
 * Covers the ratified definition end-to-end: pagination-sized inputs,
 * intersection dedup, archived exclusion (liveness = archived=false, never
 * status), hidden-service exclusion (counted-service policy v1),
 * CUSTOM-reference irrelevance, unknown-id irrelevance, and the
 * single-location floor 0→1 (count-only; the id set stays truthful).
 */
import { describe, expect, it } from 'vitest';
import { countBillableLocations } from '../../src/billing/counter/countBillableLocations';
import type {
  BillableLocationCandidate,
  BillableServiceCandidate,
  BillableServiceLocationRef,
} from '../../src/billing/counter/countBillableLocations';
import type { FetchedPage } from '../../src/billing/counter/ports';

function locationPages(idsPerPage: string[][]): FetchedPage<BillableLocationCandidate>[] {
  return idsPerPage.map((ids) => ({
    items: ids.map((locationId) => ({ locationId, archived: false })),
  }));
}

function rawLocationPages(
  itemsPerPage: BillableLocationCandidate[][],
): FetchedPage<BillableLocationCandidate>[] {
  return itemsPerPage.map((items) => ({ items }));
}

function businessRef(locationId: string): BillableServiceLocationRef {
  return { type: 'BUSINESS', business: { id: locationId } };
}

function service(
  hidden: boolean,
  ...refs: BillableServiceLocationRef[]
): BillableServiceCandidate {
  return { hidden, locations: refs };
}

function servicePages(
  servicesPerPage: BillableServiceCandidate[][],
): FetchedPage<BillableServiceCandidate>[] {
  return servicesPerPage.map((items) => ({ items }));
}

describe('countBillableLocations (pure core)', () => {
  it('counts the intersection of live locations and BUSINESS service references on a single page', () => {
    const locations = locationPages([['loc-a', 'loc-b', 'loc-c']]);
    const services = servicePages([
      [service(false, businessRef('loc-b'), businessRef('loc-a'))],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(2);
    expect(result.billableLocationIds).toEqual(['loc-a', 'loc-b']);
  });

  it('handles >50 locations paginated 50/50/30 (130 total, all referenced)', () => {
    const ids = Array.from({ length: 130 }, (_, i) => `loc-${String(i).padStart(3, '0')}`);
    const locations = locationPages([ids.slice(0, 50), ids.slice(50, 100), ids.slice(100)]);
    const services = servicePages([ids.map((id) => service(false, businessRef(id)))]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(130);
    expect(result.billableLocationIds).toHaveLength(130);
  });

  it('handles >100 services paginated 100/100/50 (250 services referencing 60 locations)', () => {
    const referencedIds = Array.from(
      { length: 60 },
      (_, i) => `target-${String(i).padStart(2, '0')}`,
    );
    const locations = locationPages([referencedIds]);
    const services = Array.from({ length: 250 }, (_, i) =>
      service(false, businessRef(`target-${String(i % 60).padStart(2, '0')}`)),
    );

    const result = countBillableLocations(locations, [
      { items: services.slice(0, 100) },
      { items: services.slice(100, 200) },
      { items: services.slice(200) },
    ]);

    expect(result.count).toBe(60);
    expect(result.billableLocationIds).toEqual([...referencedIds].sort());
  });

  it('excludes archived locations even when services reference them (liveness = archived=false, never status)', () => {
    // Contract §4.2: archiving is permanent and does NOT change status, so the
    // ratified liveness filter is the `archived` boolean alone.
    const locations = rawLocationPages([
      [
        { locationId: 'loc-live', archived: false },
        { locationId: 'loc-archived', archived: true },
      ],
    ]);
    const services = servicePages([
      [service(false, businessRef('loc-live'), businessRef('loc-archived'))],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual(['loc-live']);
  });

  it('ignores hidden services (counted-service policy v1: non-hidden services only)', () => {
    const locations = locationPages([['loc-a', 'loc-hidden-ref']]);
    const services = servicePages([
      [service(true, businessRef('loc-hidden-ref')), service(false, businessRef('loc-a'))],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual(['loc-a']);
  });

  it('applies the single-location floor when only CUSTOM references exist (computed 0 ⇒ billed 1)', () => {
    // Contract §7: computed 0 ⇒ treat as 1, documented in UI. The floor bumps
    // ONLY the count; the id set stays the true (empty) computed set.
    const locations = locationPages([['loc-1', 'loc-2']]);
    const services = servicePages([
      [service(false, { type: 'CUSTOM', business: { id: 'loc-1' } })],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual([]);
  });

  it('applies the single-location floor for completely empty inputs', () => {
    const result = countBillableLocations([], []);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual([]);
  });

  it('counts a location once despite several referencing services and duplicate refs within one service', () => {
    const locations = locationPages([['loc-x']]);
    const services = servicePages([
      [
        service(false, businessRef('loc-x'), businessRef('loc-x')),
        service(false, businessRef('loc-x')),
      ],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual(['loc-x']);
  });

  it('excludes live locations that no counted service references', () => {
    const locations = locationPages([['loc-referenced', 'loc-orphan']]);
    const services = servicePages([[service(false, businessRef('loc-referenced'))]]);

    const result = countBillableLocations(locations, services);

    expect(result.billableLocationIds).toEqual(['loc-referenced']);
  });

  it('ignores references to location ids that do not exist (floor applies)', () => {
    const locations = locationPages([['loc-real']]);
    const services = servicePages([[service(false, businessRef('loc-ghost'))]]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1); // computed 0 ⇒ floor 1
    expect(result.billableLocationIds).toEqual([]);
  });

  it('requires type BUSINESS with a non-empty business.id (CUSTOM/CUSTOMER/malformed refs are not connectivity)', () => {
    const ids = ['loc-c', 'loc-k', 'loc-n', 'loc-empty', 'loc-nobiz', 'loc-emptybiz', 'loc-ok'];
    const locations = locationPages([ids]);
    const services = servicePages([
      [
        service(false, {
          type: 'CUSTOM',
          business: { id: 'loc-c' },
        }, {
          type: 'CUSTOMER',
          business: { id: 'loc-k' },
        }, {
          business: { id: 'loc-n' },
        }, {
          type: 'BUSINESS',
          business: { id: '' },
        }, {
          type: 'BUSINESS',
        }, {
          type: 'BUSINESS',
          business: {},
        }, businessRef('loc-ok')),
      ],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual(['loc-ok']);
  });

  it('mixed scenario yields exactly the expected subset', () => {
    const locations = rawLocationPages([
      [
        { locationId: 'loc-archived', archived: true },
        { locationId: 'loc-unref', archived: false },
        { locationId: 'loc-custom-only', archived: false },
        { locationId: 'loc-behind-hidden', archived: false },
        { locationId: 'loc-counted', archived: false },
      ],
    ]);
    const services = servicePages([
      [
        service(true, businessRef('loc-behind-hidden')),
        service(false, { type: 'CUSTOM', business: { id: 'loc-custom-only' } }),
        service(false, businessRef('loc-counted'), businessRef('loc-archived')),
      ],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(1);
    expect(result.billableLocationIds).toEqual(['loc-counted']);
  });

  it('dedups location rows repeated across pages and references repeated across service pages', () => {
    const locations = locationPages([
      ['loc-1', 'loc-2'],
      ['loc-2', 'loc-3'], // loc-2 repeats across pages — Set-based core must dedup
    ]);
    const services = servicePages([
      [service(false, businessRef('loc-1'))],
      [service(false, businessRef('loc-1')), service(false, businessRef('loc-3'))],
    ]);

    const result = countBillableLocations(locations, services);

    expect(result.count).toBe(2);
    expect(result.billableLocationIds).toEqual(['loc-1', 'loc-3']);
  });
});
