import { extendedBookings } from '@wix/bookings';
import { auth } from '@wix/essentials';
import type { BookingStatus, CountQuery } from '../../../shared/types';
import type { ExistingBookingFact } from '../../../domain/duplicates/duplicates';

const elevatedQuery = auth.elevate(extendedBookings.queryExtendedBookings);
const ACTIVE_DUPLICATE_STATUSES: BookingStatus[] = ['CREATED', 'PENDING', 'CONFIRMED', 'UPDATED'];

function buildCountFilter(query: CountQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    startDate: { $gte: query.fromUtc, $lt: query.toUtc },
    status: { $in: query.includedStatuses },
  };
  if (query.serviceId) filter['bookedEntity.item.slot.serviceId'] = { $eq: query.serviceId };
  if (query.locationId) filter['bookedEntity.item.slot.location.id'] = { $eq: query.locationId };
  return filter;
}

function responseCount(response: any): number | null {
  for (const candidate of [response, response?.count, response?.totalCount, response?.pagingMetadata?.total]) {
    const numeric = typeof candidate === 'number' ? candidate : Number.NaN;
    if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

export async function countBookings(query: CountQuery): Promise<number> {
  const countMethod = (extendedBookings as any).countExtendedBookings;
  if (typeof countMethod === 'function') {
    const elevatedCount = auth.elevate(countMethod);
    const response = await elevatedCount({ filter: buildCountFilter(query) });
    const count = responseCount(response);
    if (count !== null) return count;
  }

  // Compatibility fallback for SDK builds that predate Count Extended Bookings.
  // Never silently truncate: 100 results means the exact count is unknown and
  // the pure validation layer will apply its documented cap-degradation posture.
  const response: any = await elevatedQuery({
    filter: buildCountFilter(query),
    pagingMetadata: { limit: 100 },
  } as any);
  const rows = Array.isArray(response?.extendedBookings) ? response.extendedBookings : [];
  if (rows.length >= 100) throw new Error('BOOKINGS_COUNT_EXACTNESS_UNAVAILABLE');
  return rows.length;
}

function slotOf(booking: any): any {
  return booking?.bookedEntity?.item?.slot ?? booking?.bookedEntity?.slot ?? null;
}

function scheduleOf(booking: any): any {
  return booking?.bookedEntity?.item?.schedule ?? booking?.bookedEntity?.schedule ?? null;
}

function toFact(row: any): ExistingBookingFact | null {
  const booking = row?.booking ?? row;
  const slot = slotOf(booking);
  const schedule = scheduleOf(booking);
  const serviceId = slot?.serviceId ?? schedule?.serviceId;
  const startUtc = booking?.startDate ?? slot?.startDate;
  const endUtc = booking?.endDate ?? slot?.endDate;
  if (typeof serviceId !== 'string' || typeof startUtc !== 'string' || typeof endUtc !== 'string') return null;
  return {
    bookingId: typeof booking?.id === 'string' ? booking.id : typeof booking?._id === 'string' ? booking._id : undefined,
    serviceId,
    locationId: slot?.location?.id ?? schedule?.location?.id ?? null,
    startUtc,
    endUtc,
    status: typeof booking?.status === 'string' ? booking.status as BookingStatus : undefined,
    identityKey: null,
  };
}

export async function loadExistingBookings(): Promise<readonly ExistingBookingFact[]> {
  const now = Date.now();
  const from = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 730 * 24 * 60 * 60 * 1000).toISOString();
  const response: any = await elevatedQuery({
    filter: {
      startDate: { $gte: from, $lt: to },
      status: { $in: ACTIVE_DUPLICATE_STATUSES },
    },
    pagingMetadata: { limit: 100 },
  } as any);
  const rows = Array.isArray(response?.extendedBookings) ? response.extendedBookings : [];
  if (rows.length >= 100) throw new Error('BOOKINGS_DUPLICATE_SNAPSHOT_TRUNCATED');
  return rows.map(toFact).filter((value: ExistingBookingFact | null): value is ExistingBookingFact => value !== null);
}
