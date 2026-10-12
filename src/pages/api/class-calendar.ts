import type { APIRoute } from 'astro';
import { eventTimeSlots, services } from '@wix/bookings';
import { auth } from '@wix/essentials';
import {
  applicableLimits,
  countQueryForLimit,
  evaluateRules,
  resolveSlot,
} from '../../domain';
import type { BookingFacts, CountQuery, RuleSet } from '../../domain';
import { instantForLocalWall } from '../../domain/time/intlZone';
import { countBookings } from '../../extensions/backend/runtime/bookings-reader';
import { loadLatestStateByKind } from '../../extensions/backend/runtime/state-store';
import { eventIdFromTimeSlot } from '../../platform/bookings/eventTimeSlot';
import { countQueryKey } from '../../platform/validation-plugin/counters';

const elevatedListEventTimeSlots = auth.elevate(eventTimeSlots.listEventTimeSlots);
const elevatedQueryServices = auth.elevate((services as any).queryServices);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}

function isLocalDate(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function localDateTimeToInstant(value: unknown, timeZone: unknown): string | null {
  if (typeof value !== 'string' || typeof timeZone !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const date = match[1];
  if (!date || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return instantForLocalWall(timeZone, date, hour * 60 + minute);
}

function locationIdOf(slot: any): string | null {
  const candidates = [
    slot?.location?.business?.id,
    slot?.location?.business?._id,
    slot?.location?.id,
    slot?.location?._id,
  ];
  return candidates.find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

function slotRows(response: any): any[] {
  for (const candidate of [response?.timeSlots, response?.items, response?.eventTimeSlots]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function serviceRows(response: any): any[] {
  for (const candidate of [response?.items, response?.services]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!isLocalDate(from) || !isLocalDate(to)) {
      return json(
        {
          error: 'INVALID_DATE_RANGE',
          message: 'Choose a valid calendar date range and try again.',
        },
        400,
      );
    }

    const servicesResponse: any = await elevatedQueryServices({ paging: { limit: 100 } });
    const classServices = serviceRows(servicesResponse)
      .filter((service) => String(service?.type ?? '').toUpperCase() === 'CLASS')
      .map((service) => ({
        id: String(service?._id ?? service?.id ?? ''),
        name: String(service?.name ?? 'Class'),
      }))
      .filter((service) => service.id);

    if (classServices.length === 0) {
      return json({ timeZone: null, services: [], slots: [] });
    }

    const availabilityResponse: any = await elevatedListEventTimeSlots({
      fromLocalDate: `${from}T00:00:00`,
      toLocalDate: `${to}T23:59:59`,
      serviceIds: classServices.map((service) => service.id),
      includeNonBookable: false,
      cursorPaging: { limit: 1000 },
    } as any);

    const rawSlots = slotRows(availabilityResponse);
    const timeZone =
      typeof availabilityResponse?.timeZone === 'string'
        ? availabilityResponse.timeZone
        : rawSlots.find((slot) => typeof slot?.timeZone === 'string')?.timeZone ?? 'UTC';
    const names = new Map(classServices.map((service) => [service.id, service.name]));
    const activeRules = await loadLatestStateByKind<RuleSet>('active-ruleset');

    const candidates = rawSlots
      .map((slot) => {
        const serviceId =
          typeof slot?.serviceId === 'string'
            ? slot.serviceId
            : typeof slot?.service?._id === 'string'
              ? slot.service._id
              : null;
        const eventId = eventIdFromTimeSlot(slot);
        const start = localDateTimeToInstant(slot?.localStartDate, timeZone);
        const end = localDateTimeToInstant(slot?.localEndDate, timeZone);
        if (!serviceId || !eventId || !start || !end) return null;
        const facts: BookingFacts = {
          at: start,
          serviceId,
          serviceType: 'CLASS',
          locationId: locationIdOf(slot),
          slotStart: start,
          slotEnd: end,
          timezone: timeZone,
          identityKey: null,
        };
        return { slot, serviceId, eventId, start, end, facts };
      })
      .filter(Boolean) as Array<{
        slot: any;
        serviceId: string;
        eventId: string;
        start: string;
        end: string;
        facts: BookingFacts;
      }>;

    const countQueries = new Map<string, CountQuery>();
    if (activeRules) {
      for (const candidate of candidates) {
        try {
          const resolved = resolveSlot(
            candidate.facts.slotStart!,
            candidate.facts.slotEnd!,
            candidate.facts.timezone,
          );
          for (const limit of applicableLimits(activeRules, candidate.facts)) {
            const query = countQueryForLimit(
              limit,
              candidate.facts,
              resolved.targetDate,
              candidate.facts.timezone,
            );
            countQueries.set(countQueryKey(query), query);
          }
        } catch {
          // evaluateRules will classify malformed slots; no counter is needed.
        }
      }
    }

    const countValues = new Map<string, number | null>();
    await Promise.all(
      [...countQueries.entries()].map(async ([key, query]) => {
        try {
          countValues.set(key, await countBookings(query));
        } catch {
          countValues.set(key, null);
        }
      }),
    );

    const entitlement = {
      allowedLocationIds: Object.keys(activeRules?.locationWindows ?? {}),
      overLimit: false,
      degraded: true,
      warning: 'Coverage is evaluated fail-open in the customer calendar.',
    };

    const slots = candidates
      .filter((candidate) => {
        if (!activeRules) return true;
        const outcome = evaluateRules(candidate.facts, activeRules, {
          entitlement,
          countForQuery: (query) => countValues.get(countQueryKey(query)) ?? null,
          existingBookings: () => [],
          targetContext: { target: 'CREATE' },
        });
        return outcome.decision === 'allow';
      })
      .map(({ slot, serviceId, eventId }) => ({
        eventId,
        serviceId,
        serviceName: names.get(serviceId) ?? 'Class',
        localStartDate: slot.localStartDate,
        localEndDate: slot.localEndDate,
        remainingCapacity:
          typeof slot?.remainingCapacity === 'number'
            ? slot.remainingCapacity
            : typeof slot?.bookableCapacity === 'number'
              ? slot.bookableCapacity
              : null,
        bookingUrl:
          `/booking-form?bookings_sessionId=${encodeURIComponent(eventId)}&bookings_timezone=${encodeURIComponent(timeZone)}`,
      }));

    return json({
      timeZone,
      services: classServices,
      slots,
      filteredByAdvancedRules: Boolean(activeRules),
    });
  } catch (error) {
    console.error('GET /api/class-calendar failed', error);
    return json(
      {
        error: 'CLASS_CALENDAR_UNAVAILABLE',
        message: 'Class availability could not be loaded. Please try again.',
      },
      500,
    );
  }
};
