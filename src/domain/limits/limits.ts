/**
 * Booking-count limits (caps) per day / service / location.
 *
 * Contract alignment:
 *  - Caps count bookings with the limit's DECLARED includedStatuses
 *    (Contract §10 #8); CANCELED never consumes capacity unless a merchant
 *    explicitly declares it.
 *  - The proposal day is bucketed in the SITE IANA zone (§4.7), then converted
 *    to the UTC-bounded interval that Count Extended Bookings requires (§4.7:
 *    "Query/Count Extended Bookings date filters take UTC").
 *  - Boundary semantics: at-limit (count >= maxCount) blocks; one-under
 *    allows. A cancellation frees capacity by leaving the declared status set.
 */

import { instantForLocalWall } from '../time/intlZone';
import { nextLocalDate } from '../model/primitives';
import type { CountQuery, LimitDTO, BookingFacts } from '../../shared/types';
import type { RuleSet } from '../ports';

/** Limits applicable to the proposal scope (dimension + target match). */
export function applicableLimits(
  rules: RuleSet,
  facts: Pick<BookingFacts, 'serviceId' | 'locationId'>,
): LimitDTO[] {
  const out: LimitDTO[] = [];
  for (const limit of rules.limits) {
    switch (limit.dimension) {
      case 'DAY':
        out.push(limit);
        break;
      case 'SERVICE':
        if (limit.targetId === facts.serviceId) out.push(limit);
        break;
      case 'LOCATION':
        if (facts.locationId && limit.targetId === facts.locationId) out.push(limit);
        break;
    }
  }
  return out;
}

/**
 * UTC-bounded count query for the SITE-ZONE day containing the proposal
 * (`targetDate`), narrowed by the limit's dimension and declared statuses.
 */
export function countQueryForLimit(
  limit: LimitDTO,
  facts: Pick<BookingFacts, 'serviceId' | 'locationId'>,
  targetDate: string,
  timezone: string,
): CountQuery {
  const fromUtc = instantForLocalWall(timezone, targetDate, 0);
  const toUtc = instantForLocalWall(timezone, nextLocalDate(targetDate), 0);
  const query: CountQuery = {
    fromUtc,
    toUtc,
    includedStatuses: [...limit.includedStatuses],
  };
  if (limit.dimension === 'SERVICE') {
    query.serviceId = facts.serviceId;
  }
  if (limit.dimension === 'LOCATION' && facts.locationId) {
    query.locationId = facts.locationId;
  }
  return query;
}
