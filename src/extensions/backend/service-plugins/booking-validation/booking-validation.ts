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
  validateBeforeCreate: (async ({ request }: any) =>
    createResults(request)) as any,
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
