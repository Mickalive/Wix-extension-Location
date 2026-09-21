import { bookingsValidation } from '@wix/bookings/service-plugins';
import { saveState } from '../../runtime/state-store';

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

    const probe = {
      requestKeys:
        request && typeof request === 'object' ? Object.keys(request).sort() : [],
      itemKeys: item && typeof item === 'object' ? Object.keys(item).sort() : [],
      bookingKeys:
        booking && typeof booking === 'object' ? Object.keys(booking).sort() : [],
      bookedEntityKeys:
        bookedEntity && typeof bookedEntity === 'object'
          ? Object.keys(bookedEntity).sort()
          : [],
      slotKeys:
        slot && typeof slot === 'object' ? Object.keys(slot).sort() : [],
      itemIndex: item?.itemIndex ?? null,
      bookingId: booking?.id ?? null,
      slot: slot
        ? {
            serviceId: slot.serviceId ?? null,
            scheduleId: slot.scheduleId ?? null,
            eventId: slot.eventId ?? null,
            startDate: slot.startDate ?? null,
            endDate: slot.endDate ?? null,
            timezone: slot.timezone ?? null,
            location: slot.location ?? null,
          }
        : null,
    };

    await saveState(
      '4cc087f6-b275-49ed-8834-4d63984b5893',
      'payload-probe',
      'degradation',
      probe,
    );

    return createResults(request);
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
