import type { ValidationHandlerResult, ValidationItemResult } from './handlers';
import type { ValidationTarget } from './targets';

function validationResult(item: ValidationItemResult) {
  if (item.valid) {
    return { valid: true };
  }

  return {
    valid: false,
    invalidReason: {
      message:
        item.invalidReason?.message ??
        'This booking does not satisfy the configured booking rules.',
    },
  };
}

function rawItemAt(request: any, index: number): any {
  if (!request || !Array.isArray(request.items)) return null;
  return request.items[index] ?? null;
}

function createItemResult(request: any, item: ValidationItemResult) {
  const raw = rawItemAt(request, item.index);
  const itemIndex =
    raw && Number.isInteger(raw.itemIndex) ? raw.itemIndex : item.index;

  return {
    itemIndex,
    result: validationResult(item),
  };
}

function bookingItemResult(request: any, item: ValidationItemResult) {
  const raw = rawItemAt(request, item.index);
  const bookingId = raw?.booking?.id;

  if (typeof bookingId !== 'string' || bookingId.length === 0) {
    throw new Error(
      `BOOKINGS_VALIDATION_RESPONSE_MISSING_BOOKING_ID at items[${item.index}]`,
    );
  }

  return {
    bookingId,
    result: validationResult(item),
  };
}

/**
 * Maps the domain validation result to Wix Bookings Validation's exact SPI
 * response envelope.
 *
 * CREATE targets correlate results with itemIndex. CANCEL/RESCHEDULE targets
 * correlate results with bookingId. Multi-service methods use the same item
 * shapes under singleServiceBookingResults.
 */
export function toWixValidationResponse(
  target: ValidationTarget,
  request: any,
  handlerResult: ValidationHandlerResult,
) {
  const sorted = [...handlerResult.results].sort(
    (a, b) => a.index - b.index,
  );

  const isCreate =
    target === 'CREATE' || target === 'CREATE_MULTI_SERVICE';
  const entries = isCreate
    ? sorted.map((item) => createItemResult(request, item))
    : sorted.map((item) => bookingItemResult(request, item));

  if (target.endsWith('_MULTI_SERVICE')) {
    return { singleServiceBookingResults: entries };
  }

  return { results: entries };
}
