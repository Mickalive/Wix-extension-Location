import { bookingsValidation } from '@wix/bookings/service-plugins';
import { auth } from '@wix/essentials';
import { createValidationHandlers } from '../../../../platform/validation-plugin/handlers';
import { toWixValidationResponse } from '../../../../platform/validation-plugin/wix-contract';
import type { DegradationRecord } from '../../../../platform/validation-plugin/incidents';
import type { RuleSet } from '../../../../domain';
import { countBookings, loadExistingBookings } from '../../runtime/bookings-reader';
import { loadState, saveState } from '../../runtime/state-store';

async function currentInstanceId(): Promise<string> {
  const token = await auth.getTokenInfo();
  if (!token?.instanceId) throw new Error('WIX_APP_INSTANCE_UNAVAILABLE');
  return token.instanceId;
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
  // Billing never gets to block bookings while the sandbox meter is not yet
  // authoritative. `degraded:true` deliberately tells the pure engine to
  // evaluate every configured rule rather than exclude locations by plan.
  entitlementGate: {
    async allowedLocationIds() {
      const active = await loadState<RuleSet>(await currentInstanceId(), 'active-ruleset');
      return {
        allowedLocationIds: Object.keys(active?.locationWindows ?? {}),
        overLimit: false,
        degraded: true,
        warning: 'Plan coverage is not authoritative on this sandbox; booking rules remain enforced for all locations.',
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

export default bookingsValidation.provideHandlers({
  validateBeforeCreate: (async ({ request }: any) =>
    toWixValidationResponse('CREATE', request, await handlers.CREATE(request))) as any,
  validateBeforeCancel: (async ({ request }: any) =>
    toWixValidationResponse('CANCEL', request, await handlers.CANCEL(request))) as any,
  validateBeforeReschedule: (async ({ request }: any) =>
    toWixValidationResponse('RESCHEDULE', request, await handlers.RESCHEDULE(request))) as any,
  validateBeforeCreateMultiService: (async ({ request }: any) =>
    toWixValidationResponse(
      'CREATE_MULTI_SERVICE',
      request,
      await handlers.CREATE_MULTI_SERVICE(request),
    )) as any,
  validateBeforeCancelMultiService: (async ({ request }: any) =>
    toWixValidationResponse(
      'CANCEL_MULTI_SERVICE',
      request,
      await handlers.CANCEL_MULTI_SERVICE(request),
    )) as any,
  validateBeforeRescheduleMultiService: (async ({ request }: any) =>
    toWixValidationResponse(
      'RESCHEDULE_MULTI_SERVICE',
      request,
      await handlers.RESCHEDULE_MULTI_SERVICE(request),
    )) as any,
} as any);
