/**
 * In-memory fake {@link AvailabilityGateway} (Blueprint §3; Contract §8.2).
 * Filters seeded slots by service, optional location, and local-date bounds.
 * Timezone-aware day math stays in the domain/time lane; this fake filters on
 * the stored `localDate` field exactly as a Time Slots V2 adapter would receive
 * pre-computed local dates from the API request window.
 */
import { PlatformError } from '../../contracts';
import type { Slot, AvailabilityGateway, SlotQuery } from '../../contracts';

export class FakeAvailabilityGateway implements AvailabilityGateway {
  private readonly slotsByService = new Map<string, Slot[]>();

  seed(slots: Slot[]): void {
    for (const slot of slots) {
      const list = this.slotsByService.get(slot.serviceId) ?? [];
      list.push(structuredClone(slot));
      this.slotsByService.set(slot.serviceId, list);
    }
  }

  async slots(q: SlotQuery): Promise<Slot[]> {
    if (q.fromDate > q.toDate) {
      throw new PlatformError('INVALID_QUERY', `fromDate ${q.fromDate} after toDate ${q.toDate}`);
    }
    if (!q.serviceId) {
      throw new PlatformError('INVALID_QUERY', 'serviceId is required');
    }
    const list = this.slotsByService.get(q.serviceId) ?? [];
    return structuredClone(
      list.filter(
        (s) =>
          s.localDate >= q.fromDate &&
          s.localDate <= q.toDate &&
          (q.locationId === undefined || (s.locationId ?? null) === q.locationId),
      ),
    );
  }
}
