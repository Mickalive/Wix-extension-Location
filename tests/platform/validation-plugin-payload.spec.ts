/**
 * Structural payload parsing for the validation-plugin path (INT-C3-1 item d;
 * Contract §5.3, Invariant C1). Proves:
 *  - ONLY documented payload fields survive parsing (contactDetails content,
 *    UNPROVEN contactId survivors and any junk are dropped at the boundary);
 *  - location.id is extracted exclusively for OWNER_BUSINESS locations;
 *  - metadata.identity is observed structurally (never consumed here);
 *  - structural violations reject typed INVALID_QUERY before any dependency;
 *  - the bulk cap maxItems 12 is enforced with an explicit boundary test.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_ITEMS,
  ownerBusinessLocationId,
  parseValidationRequest,
} from '../../src/platform/validation-plugin';
import { rawItem, rawRequest, ANCHOR_START, ANCHOR_END, SITE_ZONE } from './helpers/validationPluginRig';

function invalidMessageOf(thunk: () => unknown): string {
  try {
    thunk();
  } catch (error) {
    return (error as { message?: string; code?: string }).message ?? '';
  }
  return '';
}

describe('documented-field-only mapping', () => {
  it('maps exactly the documented slot fields of one item', () => {
    const parsed = parseValidationRequest(
      rawRequest([
        rawItem({
          serviceId: 'svc-9',
          scheduleId: 'sched-9',
          identity: { memberId: 'mem-1' },
        }),
      ]),
    );
    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0]!;
    expect(item).toEqual({
      index: 0,
      serviceId: 'svc-9',
      scheduleId: 'sched-9',
      startDate: ANCHOR_START,
      endDate: ANCHOR_END,
      timezone: SITE_ZONE,
      location: { id: 'loc-1', locationType: 'OWNER_BUSINESS' },
      metadataIdentity: { kind: 'memberId', value: 'mem-1' },
    });
  });

  it('drops ALL undocumented fields — including redacted/UNPROVEN contactDetails survivors', () => {
    const parsed = parseValidationRequest(
      rawRequest([
        rawItem({
          extraItemFields: {
            contactDetails: {
              firstName: 'Jane',
              lastName: 'Doe',
              email: 'jane@example.com',
              phone: '+1 555 0100',
              fullAddress: '1 Main St',
              // C1: whether contactId survives platform sanitization is
              // UNPROVEN — it must be irrelevant either way: never mapped.
              contactId: 'survivor-or-not',
            },
            notes: 'junk',
          },
          extraSlotFields: { resourceId: { id: 'r-1' }, eventId: 'ev-1' },
        }),
      ]),
    );
    const item = parsed.items[0]!;
    expect(Object.keys(item).sort()).toEqual(
      [
        'index',
        'serviceId',
        'scheduleId',
        'startDate',
        'endDate',
        'timezone',
        'location',
        'metadataIdentity',
      ].sort(),
    );
    expect(JSON.stringify(item)).not.toContain('jane@example.com');
    expect(JSON.stringify(item)).not.toContain('survivor-or-not');
  });

  it('keeps location raw for the OWNER_BUSINESS gate and omits absent location', () => {
    const withCustom = parseValidationRequest(rawRequest([rawItem({ locationId: 'loc-x', locationType: 'CUSTOM' })]));
    expect(withCustom.items[0]!.location).toEqual({ id: 'loc-x', locationType: 'CUSTOM' });

    const withoutLocation = parseValidationRequest(rawRequest([rawItem({ locationId: null })]));
    expect(withoutLocation.items[0]!.location).toBeNull();
  });
});

describe('OWNER_BUSINESS-only location extraction (Contract §5.3)', () => {
  it.each([
    ['OWNER_BUSINESS + string id', 'loc-1', 'OWNER_BUSINESS', 'loc-1'],
    ['CUSTOM ignores id', 'loc-x', 'CUSTOM', null],
    ['CUSTOMER ignores id', 'loc-x', 'CUSTOMER', null],
    ['unknown type ignores id', 'loc-x', 'SATELLITE', null],
    ['missing type ignores id', 'loc-1', undefined, null],
  ])('%s', (_label, id, locationType, expected) => {
    const parsed = parseValidationRequest(
      rawRequest([rawItem({ locationId: id as string, ...(locationType === undefined ? { omitLocationType: true } : { locationType }) })]),
    );
    expect(ownerBusinessLocationId(parsed.items[0]!)).toBe(expected);
  });

  it('rejects non-string or empty ids even for OWNER_BUSINESS', () => {
    const nonString = parseValidationRequest(rawRequest([rawItem({ locationType: 'OWNER_BUSINESS' })]));
    nonString.items[0]!.location!.id = 42;
    expect(ownerBusinessLocationId(nonString.items[0]!)).toBeNull();

    const empty = parseValidationRequest(rawRequest([rawItem({ locationId: '', locationType: 'OWNER_BUSINESS' })]));
    expect(ownerBusinessLocationId(empty.items[0]!)).toBeNull();
  });
});

describe('metadata.identity observation (never consumption)', () => {
  it('recognizes each documented kind and applies fixed precedence', () => {
    const cases: Array<[Record<string, unknown>, { kind: string; value: string }]> = [
      [{ memberId: 'm1' }, { kind: 'memberId', value: 'm1' }],
      [{ wixUserId: 'u1' }, { kind: 'wixUserId', value: 'u1' }],
      [{ anonymousVisitorId: 'a1' }, { kind: 'anonymousVisitorId', value: 'a1' }],
      [{ appId: 'ap1' }, { kind: 'appId', value: 'ap1' }],
      [{ wixUserId: 'u1', memberId: 'm1' }, { kind: 'memberId', value: 'm1' }], // fixed precedence order
    ];
    for (const [identity, expected] of cases) {
      const parsed = parseValidationRequest(rawRequest([rawItem({ identity })]));
      expect(parsed.items[0]!.metadataIdentity).toEqual(expected);
    }
  });

  it('ignores unknown identity shapes entirely', () => {
    for (const identity of [{ fingerprint: 'x' }, { memberId: 42 }, 'member-1', 7]) {
      const parsed = parseValidationRequest(rawRequest([rawItem({ identity: identity as Record<string, unknown> })]));
      expect(parsed.items[0]!.metadataIdentity).toBeNull();
    }
  });
});

describe('structural rejection (typed INVALID_QUERY before any dependency)', () => {
  const expectInvalid = (thunk: () => unknown): void => {
    let caught: unknown = null;
    try {
      thunk();
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
  };

  it('rejects malformed bodies', () => {
    for (const body of [undefined, null, 42, 'items', [], {}]) {
      expectInvalid(() => parseValidationRequest(body));
    }
  });

  it('rejects missing/non-array/empty items arrays', () => {
    expectInvalid(() => parseValidationRequest({}));
    expectInvalid(() => parseValidationRequest({ items: 'twelve' }));
    expectInvalid(() => parseValidationRequest({ items: [] }));
  });

  it(`enforces the maxItems ${MAX_BULK_ITEMS} bulk cap with a clean boundary`, () => {
    const twelve = Array.from({ length: MAX_BULK_ITEMS }, () => rawItem());
    const parsed = parseValidationRequest(rawRequest(twelve));
    expect(parsed.items).toHaveLength(12);
    expect(parsed.items.map((i) => i.index)).toEqual([...Array(12).keys()]);

    const thirteen = Array.from({ length: MAX_BULK_ITEMS + 1 }, () => rawItem());
    expectInvalid(() => parseValidationRequest(rawRequest(thirteen)));
    expect(invalidMessageOf(() => parseValidationRequest(rawRequest(thirteen)))).toContain('maxItems');
  });

  it('rejects per-item structural violations', () => {
    const missingStartDate = {
      bookedEntity: { slot: { serviceId: 'svc-1', endDate: ANCHOR_END, timezone: SITE_ZONE } },
    };
    const stringLocation = {
      bookedEntity: {
        slot: {
          serviceId: 'svc-1',
          startDate: ANCHOR_START,
          endDate: ANCHOR_END,
          timezone: SITE_ZONE,
          location: 'business',
        },
      },
    };
    const cases: unknown[] = [
      42,
      {},
      { bookedEntity: {} },
      { bookedEntity: { slot: 'slot' } },
      { bookedEntity: { slot: { startDate: ANCHOR_START, endDate: ANCHOR_END, timezone: SITE_ZONE } } },
      rawItem({ serviceId: '' }),
      missingStartDate,
      rawItem({ timezone: '   ' }),
      rawItem({ scheduleId: 7 as unknown as string }),
      stringLocation,
    ];
    for (const body of cases) {
      expectInvalid(() => parseValidationRequest(rawRequest([body])));
    }
  });
});
