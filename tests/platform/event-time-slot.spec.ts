import { describe, expect, it } from 'vitest';
import { eventIdFromTimeSlot } from '../../src/platform/bookings/eventTimeSlot';

describe('Wix Bookings Time Slots V2 event id extraction', () => {
  it('reads the live Wix Time Slots V2 eventInfo.eventId shape', () => {
    const slot = {
      serviceId: '1afe4ccf-cb88-4115-91a1-d3fc44cb62e1',
      localStartDate: '2026-10-12T20:00:00',
      localEndDate: '2026-10-12T21:00:00',
      eventInfo: {
        eventId: 'live-wix-event-id',
        eventTitle: 'Restorative',
      },
    };

    expect(eventIdFromTimeSlot(slot)).toBe('live-wix-event-id');
  });

  it('keeps compatibility with older observed SDK shapes', () => {
    expect(eventIdFromTimeSlot({ eventId: 'direct-id' })).toBe('direct-id');
    expect(eventIdFromTimeSlot({ event: { id: 'nested-id' } })).toBe('nested-id');
    expect(eventIdFromTimeSlot({ event: { _id: 'nested-legacy-id' } })).toBe('nested-legacy-id');
  });

  it('returns null when Wix supplies no event identifier', () => {
    expect(eventIdFromTimeSlot({ eventInfo: {} })).toBeNull();
    expect(eventIdFromTimeSlot(null)).toBeNull();
  });
});
