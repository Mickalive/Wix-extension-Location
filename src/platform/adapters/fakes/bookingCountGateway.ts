/**
 * In-memory fake {@link BookingCountGateway} (Blueprint §3; Contract §8.2).
 * Counts seeded bookings over UTC-bounded filters with an explicit
 * status-inclusion policy, mirroring Count Extended Bookings semantics.
 */
import { PlatformError } from '../../contracts';
import type { BookingCountGateway, BookingStatus, CountQuery, Instant } from '../../contracts';

export interface SeededBooking {
  bookingId: string;
  serviceId: string;
  locationId?: string | null;
  /** Booking start instant in UTC (count filters are UTC-bounded). */
  startUtc: Instant;
  status: BookingStatus;
}

export class FakeBookingCountGateway implements BookingCountGateway {
  private readonly bookings: SeededBooking[] = [];
  private failure: Error | null = null;

  seed(bookings: SeededBooking[]): void {
    for (const b of bookings) this.bookings.push(structuredClone(b));
  }

  /** Test knob: next count() call rejects (fail-open posture tests downstream). */
  failNextWith(error: Error): void {
    this.failure = error;
  }

  async count(q: CountQuery): Promise<number> {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    if (q.fromUtc > q.toUtc) {
      throw new PlatformError('INVALID_QUERY', `fromUtc ${q.fromUtc} after toUtc ${q.toUtc}`);
    }
    if (q.includedStatuses.length === 0) {
      throw new PlatformError('INVALID_QUERY', 'includedStatuses must not be empty');
    }
    const included = new Set<BookingStatus>(q.includedStatuses);
    return this.bookings.filter(
      (b) =>
        included.has(b.status) &&
        b.startUtc >= q.fromUtc &&
        b.startUtc <= q.toUtc &&
        (q.serviceId === undefined || b.serviceId === q.serviceId) &&
        (q.locationId === undefined || (b.locationId ?? null) === q.locationId),
    ).length;
  }
}
