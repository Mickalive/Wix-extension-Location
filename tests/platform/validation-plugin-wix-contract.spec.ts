import { describe, expect, it } from 'vitest';
import {
  toWixValidationResponse,
  type ValidationTarget,
} from '../../src/platform/validation-plugin';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
  OUTSIDE_START,
  OUTSIDE_END,
} from './helpers/validationPluginRig';

describe('Wix Bookings Validation response contract', () => {
  it('wraps CREATE results with itemIndex + nested result', async () => {
    const rig = makeRig({ ruleSet: null });
    const request = rawRequest([rawItem({ itemIndex: 7 })]);
    const result = await rig.handlers.CREATE(request);

    expect(toWixValidationResponse('CREATE', request, result)).toEqual({
      results: [
        {
          itemIndex: 7,
          result: { valid: true },
        },
      ],
    });
  });

  it('wraps CANCEL and RESCHEDULE results with bookingId + nested result', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440123';
    const request = rawRequest([rawItem({ bookingId })]);
    const rig = makeRig({ ruleSet: null });

    for (const target of ['CANCEL', 'RESCHEDULE'] as const) {
      const result = await rig.handlers[target](request);
      expect(toWixValidationResponse(target, request, result)).toEqual({
        results: [
          {
            bookingId,
            result: { valid: true },
          },
        ],
      });
    }
  });

  it('uses singleServiceBookingResults for multi-service methods', async () => {
    const request = rawRequest([rawItem({ itemIndex: 3 })]);
    const rig = makeRig({ ruleSet: null });
    const result = await rig.handlers.CREATE_MULTI_SERVICE(request);

    expect(
      toWixValidationResponse('CREATE_MULTI_SERVICE', request, result),
    ).toEqual({
      singleServiceBookingResults: [
        {
          itemIndex: 3,
          result: { valid: true },
        },
      ],
    });
  });

  it('returns Wix-supported invalidReason.message without the old unsupported top-level code', async () => {
    const request = rawRequest([
      rawItem({ start: OUTSIDE_START, end: OUTSIDE_END }),
    ]);
    const rig = makeRig({
      ruleSet: openRuleSet({
        locationWindows: {
          'loc-1': [{ weekday: 'WED', start: '13:00', end: '17:00' }],
        },
      }),
    });
    const result = await rig.handlers.CREATE(request);
    const response = toWixValidationResponse('CREATE', request, result) as any;

    expect(response.results[0]).toEqual({
      itemIndex: 0,
      result: {
        valid: false,
        invalidReason: {
          message:
            'The selected time is outside opening hours. Please choose another time.',
        },
      },
    });
    expect(response.results[0].result.invalidReason.code).toBeUndefined();
  });
});

describe('target-aware request parsing', () => {
  it('evaluates targetSlot for RESCHEDULE instead of the current booked slot', async () => {
    const request = rawRequest([rawItem()]);
    const item = request.items[0] as any;
    item.targetSlot.startDate = OUTSIDE_START;
    item.targetSlot.endDate = OUTSIDE_END;

    const rules = openRuleSet({
      locationWindows: {
        'loc-1': [{ weekday: 'WED', start: '13:00', end: '17:00' }],
      },
    });
    const rig = makeRig({ ruleSet: rules });

    const create = await rig.handlers.CREATE(request);
    const reschedule = await rig.handlers.RESCHEDULE(request);

    expect(create.results[0]?.valid).toBe(true);
    expect(reschedule.results[0]?.valid).toBe(false);
    expect(reschedule.results[0]?.invalidReason?.code).toBe(
      'OUTSIDE_BOOKING_HOURS',
    );
  });

  it.each([
    'CREATE',
    'CREATE_MULTI_SERVICE',
    'CANCEL',
    'CANCEL_MULTI_SERVICE',
    'RESCHEDULE',
    'RESCHEDULE_MULTI_SERVICE',
  ] as ValidationTarget[])('%s produces a Wix-shape response', async (target) => {
    const request = rawRequest([rawItem()]);
    const rig = makeRig({ ruleSet: null });
    const result = await rig.handlers[target](request);
    const response = toWixValidationResponse(target, request, result) as any;
    const rows = target.endsWith('_MULTI_SERVICE')
      ? response.singleServiceBookingResults
      : response.results;

    expect(rows).toHaveLength(1);
    expect(rows[0].result).toEqual({ valid: true });
  });
});
