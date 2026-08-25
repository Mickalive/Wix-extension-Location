/**
 * Bulk explicitness for the validation-plugin path (INT-C3-1 acceptance
 * criterion 3; Contract §5.3: "omitted items default to valid — handlers must
 * return explicit results for every index"; bulk cap maxItems 12).
 *
 * The OMITTED-ITEM HAZARD is proven by construction: the mixed bulk below
 * interleaves exactly the situations that tempt a naive handler to omit an
 * index (uncovered-location skips, blocks, allows, multi-service tails) and
 * asserts EVERY index 0..n-1 carries an explicit result. A single gap would
 * silently APPROVE a booking on the platform side.
 */
import { describe, expect, it } from 'vitest';
import { MAX_BULK_ITEMS } from '../../src/platform/validation-plugin';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
} from './helpers/validationPluginRig';

const WINDOWED_RULES = openRuleSet({
  locationWindows: { 'loc-1': [{ weekday: 'WED', start: '13:00', end: '17:00' }] },
});

describe('explicit per-index results for every bulk item', () => {
  it('answers EVERY index in a mixed skip/block/allow bulk — the omitted-item repro', async () => {
    // Entitlement covers only loc-1 ⇒ loc-z items are enforcement-skipped.
    const items = [
      rawItem(), // 0: covered, inside hours ⇒ allow
      rawItem({ locationId: 'loc-z' }), // 1: uncovered ⇒ SKIPPED (naive handlers omit this)
      rawItem({ start: '2026-08-12T15:00:00.000Z', end: '2026-08-12T16:00:00.000Z' }), // 2: covered, outside hours ⇒ block
      rawItem({ locationId: 'loc-z' }), // 3: uncovered ⇒ SKIPPED again
      rawItem(), // 4: allow
    ];
    const rig = makeRig({ ruleSet: WINDOWED_RULES });
    const result = await rig.handlers.CREATE(rawRequest(items));

    expect(result.results).toHaveLength(items.length);
    // Exhaustiveness: every index present EXACTLY once, in order, no holes.
    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.results.map((r) => r.disposition)).toEqual([
      'RULES_EVALUATED',
      'UNCOVERED_LOCATION_RULES_SKIPPED',
      'RULES_EVALUATED',
      'UNCOVERED_LOCATION_RULES_SKIPPED',
      'RULES_EVALUATED',
    ]);
    expect(result.results.map((r) => r.valid)).toEqual([true, true, false, true, true]);
    // The skipped indices carry explicit valid entries with no domain outcome.
    expect(result.results[1]?.outcome).toBeNull();
    expect(result.results[3]?.outcome).toBeNull();
    expect(result.enforcementClaim).toBe('ENFORCED');
  });

  it(`handles the full ${MAX_BULK_ITEMS}-item boundary with explicit results everywhere`, async () => {
    const items = Array.from({ length: MAX_BULK_ITEMS }, (_, i) =>
      i % 2 === 0 ? rawItem() : rawItem({ locationId: 'loc-z' }),
    );
    const rig = makeRig(); // default-open rules ⇒ evaluated items all allow
    const result = await rig.handlers.CREATE_MULTI_SERVICE(rawRequest(items));

    expect(result.results).toHaveLength(12);
    expect(result.results.map((r) => r.index)).toEqual([...Array(MAX_BULK_ITEMS).keys()]);
    expect(result.results.every((r) => r.valid)).toBe(true);
    expect(result.results.filter((r) => r.disposition === 'UNCOVERED_LOCATION_RULES_SKIPPED')).toHaveLength(6);
    expect(result.results.filter((r) => r.disposition === 'RULES_EVALUATED')).toHaveLength(6);
  });

  it('multi-service bulk validates each sequential item independently', async () => {
    const rig = makeRig();
    const items = [
      rawItem({ serviceId: 'svc-a', start: '2026-08-12T17:00:00.000Z', end: '2026-08-12T18:00:00.000Z' }),
      rawItem({ serviceId: 'svc-b', start: '2026-08-12T18:00:00.000Z', end: '2026-08-12T19:00:00.000Z' }),
      rawItem({ serviceId: 'svc-c', start: '2026-08-12T19:00:00.000Z', end: '2026-08-12T20:00:00.000Z' }),
    ];
    const result = await rig.handlers.CREATE_MULTI_SERVICE(rawRequest(items));
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.valid && r.disposition === 'RULES_EVALUATED')).toBe(true);
  });

  it('fail-closed internal failure still answers EVERY index of a max-size bulk', async () => {
    const rig = makeRig({
      configStoreError: new Error('store down'),
    });
    const items = Array.from({ length: MAX_BULK_ITEMS }, () => rawItem());
    const result = await rig.handlers.CANCEL(rawRequest(items));
    expect(result.results).toHaveLength(12);
    expect(result.results.map((r) => r.index)).toEqual([...Array(12).keys()]);
    expect(result.results.every((r) => r.valid === false && r.invalidReason?.code === 'VALIDATION_UNAVAILABLE')).toBe(true);
  });
});

describe('bulk structural limits', () => {
  it('rejects more than maxItems with INVALID_QUERY before any dependency runs', async () => {
    const rig = makeRig();
    const tooMany = Array.from({ length: MAX_BULK_ITEMS + 1 }, () => rawItem());

    let caught: unknown = null;
    try {
      await rig.handlers.CREATE(rawRequest(tooMany));
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    expect((caught as { message?: string }).message).toContain('maxItems');
    // Rejection precedes ALL dependency interaction.
    expect(rig.countingGateway.calls).toBe(0);
    expect(rig.existingCalls()).toBe(0);
    expect(rig.sink.records).toEqual([]);
  });

  it('rejects empty and non-array items with INVALID_QUERY', async () => {
    const rig = makeRig();
    for (const body of [{ items: [] }, { items: 'one' }, {}]) {
      let caught: unknown = null;
      try {
        await rig.handlers.RESCHEDULE(body);
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    }
    expect(rig.existingCalls()).toBe(0);
  });
});
