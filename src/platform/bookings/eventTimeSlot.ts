/**
 * Extracts the session/event identifier from Wix Bookings Time Slots V2.
 *
 * Live Wix responses currently expose class session IDs as
 * `timeSlot.eventInfo.eventId`. Older SDK shapes have also surfaced the
 * identifier directly or under `event`, so keep those fallbacks for
 * compatibility.
 */
export function eventIdFromTimeSlot(slot: any): string | null {
  const candidates = [
    slot?.eventInfo?.eventId,
    slot?.eventId,
    slot?.event?.id,
    slot?.event?._id,
  ];
  return (
    candidates.find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? null
  );
}
