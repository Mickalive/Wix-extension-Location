import { bookingsValidation } from '@wix/bookings/service-plugins';

function createResults(request: any) {
  const items = Array.isArray(request?.items) ? request.items : [];
  return {
    results: items.map((item: any, index: number) => ({
      itemIndex: Number.isInteger(item?.itemIndex) ? item.itemIndex : index,
      result: { valid: true },
    })),
  };
}

function bookingResults(request: any, multi = false) {
  const items = Array.isArray(request?.items) ? request.items : [];
  const results = items.map((item: any) => ({
    bookingId: item?.booking?.id,
    result: { valid: true },
  }));
  return multi ? { singleServiceBookingResults: results } : { results };
}

function createMultiResults(request: any) {
  const items = Array.isArray(request?.items) ? request.items : [];
  return {
    singleServiceBookingResults: items.map((item: any, index: number) => ({
      itemIndex: Number.isInteger(item?.itemIndex) ? item.itemIndex : index,
      result: { valid: true },
    })),
  };
}

/**
 * Temporary live canary: no app state, auth, counters, or rule evaluation.
 * If a booking still returns 500 with this provider, the fault is at the Wix
 * extension registration/runtime boundary rather than inside our rule engine.
 */
export default bookingsValidation.provideHandlers({
  validateBeforeCreate: (async ({ request }: any) => {
    const item = Array.isArray(request?.items) ? request.items[0] : null;
    const booking = item?.booking;
    const bookedEntity = booking?.bookedEntity;
    const slot = bookedEntity?.slot;
    const keys = slot && typeof slot === 'object' ? Object.keys(slot).sort().join(',') : '-';
    const message = [
      'ABR_PAYLOAD',
      `items=${Array.isArray(request?.items)}`,
      `booking=${!!booking}`,
      `entity=${!!bookedEntity}`,
      `slot=${!!slot}`,
      `svc=${typeof slot?.serviceId}`,
      `start=${typeof slot?.startDate}`,
      `end=${typeof slot?.endDate}`,
      `tz=${typeof slot?.timezone}`,
      `loc=${typeof slot?.location}`,
      `keys=${keys}`,
    ].join(';').slice(0, 300);

    return {
      results: [
        {
          itemIndex: Number.isInteger(item?.itemIndex) ? item.itemIndex : 0,
          result: {
            valid: false,
            invalidReason: { message },
          },
        },
      ],
    };
  }) as any,
  validateBeforeCancel: (async ({ request }: any) =>
    bookingResults(request)) as any,
  validateBeforeReschedule: (async ({ request }: any) =>
    bookingResults(request)) as any,
  validateBeforeCreateMultiService: (async ({ request }: any) =>
    createMultiResults(request)) as any,
  validateBeforeCancelMultiService: (async ({ request }: any) =>
    bookingResults(request, true)) as any,
  validateBeforeRescheduleMultiService: (async ({ request }: any) =>
    bookingResults(request, true)) as any,
} as any);
