/**
 * Over-limit coverage selection (BILL-C2-1-REPAIR; Contract §7 over-limit
 * behavior, directives/BILLING.md downgrade safety).
 *
 * Proves: stable ordering (default first, then alphabetical id), slicing to
 * the allowance, preservation of excess locations (management disabled —
 * never deleted), determinism under shuffling with frozen inputs, defensive
 * archived filtering and duplicate-id dedup.
 */
import { describe, expect, it } from 'vitest';
import { selectManagedLocations } from '../../src/billing/pure/coverage';
import type { ManagedLocationRecord } from '../../src/billing/types';

function rec(
  locationId: string,
  opts?: { archived?: boolean; isDefault?: boolean },
): ManagedLocationRecord {
  return {
    locationId,
    archived: opts?.archived ?? false,
    isDefault: opts?.isDefault,
  };
}

describe('selectManagedLocations (pure coverage ordering)', () => {
  it('orders default-first then alphabetically and slices to the allowance', () => {
    const selection = selectManagedLocations(
      [
        rec('loc-z'),
        rec('loc-a'),
        rec('loc-m', { isDefault: true }),
        rec('loc-b'),
        rec('loc-c'),
      ],
      3,
    );

    expect(selection.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
    expect(selection.unmanagedLocationIds).toEqual(['loc-c', 'loc-z']);
    expect(selection.overLimit).toBe(true);
  });

  it('never deletes over-limit locations: allowed ∪ unmanaged preserves every managed id', () => {
    const records = [
      rec('loc-5'),
      rec('loc-3', { isDefault: true }),
      rec('loc-4'),
      rec('loc-2'),
      rec('loc-1'),
    ];
    const before = JSON.parse(JSON.stringify(records)) as ManagedLocationRecord[];

    const selection = selectManagedLocations(records, 2);

    expect(selection.allowedLocationIds).toEqual(['loc-3', 'loc-1']);
    expect(selection.unmanagedLocationIds).toEqual(['loc-2', 'loc-4', 'loc-5']);
    expect([...selection.allowedLocationIds, ...selection.unmanagedLocationIds].sort()).toEqual(
      before.map((r) => r.locationId).sort(),
    );
    // Input untouched (no silent destructive rewrite of customer data).
    expect(records).toEqual(before);
  });

  it('reports a clean within-limit selection without over-limit signaling', () => {
    const selection = selectManagedLocations(
      [rec('loc-b'), rec('loc-a'), rec('loc-c')],
      10,
    );

    expect(selection).toEqual({
      allowedLocationIds: ['loc-a', 'loc-b', 'loc-c'],
      unmanagedLocationIds: [],
      overLimit: false,
    });
  });

  it('is deterministic and non-mutating across 50 repeated runs over reversed deep-frozen inputs', () => {
    const records: readonly ManagedLocationRecord[] = [
      rec('loc-delta'),
      rec('loc-alpha', { isDefault: true }),
      rec('loc-charlie'),
      rec('loc-bravo'),
      rec('loc-echo'),
    ].map((record) => Object.freeze(record));
    const before = JSON.parse(JSON.stringify(records)) as readonly ManagedLocationRecord[];

    let reference: ReturnType<typeof selectManagedLocations> | null = null;
    for (let run = 0; run < 50; run += 1) {
      const input = run % 2 === 0 ? records : [...records].reverse();
      const selection = selectManagedLocations(input, 3);
      if (reference === null) {
        reference = selection;
      } else {
        expect(selection).toEqual(reference);
      }
    }

    expect(reference).not.toBeNull();
    expect(reference?.allowedLocationIds).toEqual([
      'loc-alpha',
      'loc-bravo',
      'loc-charlie',
    ]);
    expect(records).toEqual(before);
  });

  it('excludes archived locations defensively and dedups duplicate ids in stable order', () => {
    const selection = selectManagedLocations(
      [
        rec('loc-a', { isDefault: true }),
        rec('loc-a'), // duplicate id — first occurrence in stable order wins
        rec('loc-b', { archived: true }), // never managed, even if listed
        rec('loc-c'),
      ],
      10,
    );

    expect(selection.allowedLocationIds).toEqual(['loc-a', 'loc-c']);
    expect(selection.unmanagedLocationIds).toEqual([]);
    expect(selection.overLimit).toBe(false);
  });
});
