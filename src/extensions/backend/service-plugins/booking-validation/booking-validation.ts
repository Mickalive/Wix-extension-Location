import { eventTimeSlots } from '@wix/bookings';
import { bookingsValidation } from '@wix/bookings/service-plugins';
import { auth } from '@wix/essentials';
import type { RuleSet } from '../../../../domain';
import { instantForLocalWall } from '../../../../domain/time/intlZone';
import { createValidationHandlers } from '../../../../platform/validation-plugin/handlers';
import type { DegradationRecord } from '../../../../platform/validation-plugin/incidents';
import { toWixValidationResponse } from '../../../../platform/validation-plugin/wix-contract';
import { countBookings, loadExistingBookings } from '../../runtime/bookings-reader';
import { loadState, saveState } from '../../runtime/state-store';

async function currentInstanceId(): Promise<string> {
  const token = await auth.getTokenInfo();
  if (!token?.instanceId) throw new Error('WIX_APP_INSTANCE_UNAVAILABLE');
  return token.instanceId;
}

function localDateTimeToInstant(value: unknown, timeZone: unknown): string | null {
  if (typeof value !== 'string' || typeof timeZone !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const localDate = match[1];
  if (!localDate) return null;
  return instantForLocalWall(timeZone, localDate, hour * 60 + minute);
}

const elevatedGetEventTimeSlot = auth.elevate(eventTimeSlots.getEventTimeSlot);

async function hydrateSlot(rawSlot: any): Promise<any> {
  if (!rawSlot || typeof rawSlot !== 'object') return rawSlot;

  const alreadyComplete =
    typeof rawSlot.startDate === 'string' &&
    rawSlot.startDate.length > 0 &&
    typeof rawSlot.endDate === 'string' &&
    rawSlot.endDate.length > 0 &&
    typeof rawSlot.timezone === 'string' &&
    rawSlot.timezone.length > 0;

  if (alreadyComplete) return rawSlot;

  const eventId = rawSlot.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) return rawSlot;

  const response: any = await elevatedGetEventTimeSlot(eventId);
  const timeSlot = response?.timeSlot;
  const timeZone = response?.timeZone;

  if (!timeSlot || typeof timeSlot !== 'object' || typeof timeZone !== 'string') {
    return rawSlot;
  }

  const startDate = localDateTimeToInstant(timeSlot.localStartDate, timeZone);
  const endDate = localDateTimeToInstant(timeSlot.localEndDate, timeZone);

  return {
    ...rawSlot,
    serviceId: rawSlot.serviceId || timeSlot.serviceId,
    scheduleId: rawSlot.scheduleId || timeSlot.scheduleId || null,
    startDate: rawSlot.startDate || startDate,
    endDate: rawSlot.endDate || endDate,
    timezone: rawSlot.timezone || timeZone,
    location: rawSlot.location || timeSlot.location || null,
  };
}

async function hydrateValidationRequest(request: any): Promise<any> {
  if (!request || !Array.isArray(request.items)) return request;

  const items = await Promise.all(
    request.items.map(async (rawItem: any) => {
      if (!rawItem || typeof rawItem !== 'object') return rawItem;

      const booking = rawItem.booking;
      const bookedEntity = booking?.bookedEntity;
      const currentSlot = bookedEntity?.slot;
      const targetSlot = rawItem.targetSlot;

      const [hydratedCurrentSlot, hydratedTargetSlot] = await Promise.all([
        hydrateSlot(currentSlot),
        hydrateSlot(targetSlot),
      ]);

      return {
        ...rawItem,
        ...(booking && typeof booking === 'object'
          ? {
              booking: {
                ...booking,
                ...(bookedEntity && typeof bookedEntity === 'object'
                  ? {
                      bookedEntity: {
                        ...bookedEntity,
                        ...(currentSlot ? { slot: hydratedCurrentSlot } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(targetSlot ? { targetSlot: hydratedTargetSlot } : {}),
      };
    }),
  );

  return { ...request, items };
}

const handlers = createValidationHandlers({
  configStore: {
    async loadActiveRuleSet(): Promise<RuleSet | null> {
      return loadState<RuleSet>(await currentInstanceId(), 'active-ruleset');
    },
    async saveRuleSet(next: RuleSet): Promise<RuleSet> {
      return saveState(await currentInstanceId(), 'active-ruleset', 'active-ruleset', next);
    },
  },
  entitlementGate: {
    async allowedLocationIds() {
      const active = await loadState<RuleSet>(await currentInstanceId(), 'active-ruleset');
      return {
        allowedLocationIds: Object.keys(active?.locationWindows ?? {}),
        overLimit: false,
        degraded: true,
        warning:
          'Plan coverage is not authoritative on this sandbox; booking rules remain enforced for all locations.',
      };
    },
  },
  counts: { count: countBookings },
  existingBookings: { loadExisting: loadExistingBookings },
  clock: {
    now: () => new Date().toISOString(),
    zone: () => 'UTC',
  },
  degradationSink: {
    async record(record: DegradationRecord): Promise<void> {
      console.warn('[advanced-booking-rules degradation]', record.kind, record.detail);
      try {
        const instanceId = await currentInstanceId();
        await saveState(instanceId, 'degradation-latest', 'degradation', record);
      } catch {
        // Persistence/alerting must never alter the booking decision.
      }
    },
  },
  deadlineMs: 4500,
});

async function run(target: keyof typeof handlers, request: any) {
  const hydrated = await hydrateValidationRequest(request);
  return toWixValidationResponse(target, hydrated, await handlers[target](hydrated));
}

export default bookingsValidation.provideHandlers({
  validateBeforeCreate: (async ({ request }: any) => run('CREATE', request)) as any,
  validateBeforeCancel: (async ({ request }: any) => run('CANCEL', request)) as any,
  validateBeforeReschedule: (async ({ request }: any) => run('RESCHEDULE', request)) as any,
  validateBeforeCreateMultiService: (async ({ request }: any) =>
    run('CREATE_MULTI_SERVICE', request)) as any,
  validateBeforeCancelMultiService: (async ({ request }: any) =>
    run('CANCEL_MULTI_SERVICE', request)) as any,
  validateBeforeRescheduleMultiService: (async ({ request }: any) =>
    run('RESCHEDULE_MULTI_SERVICE', request)) as any,
} as any);
