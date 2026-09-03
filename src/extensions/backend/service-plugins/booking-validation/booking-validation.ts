import { bookingsValidation } from '@wix/bookings/service-plugins';
import { auth } from '@wix/essentials';
import { createValidationHandlers } from '../../../../platform/validation-plugin/handlers';
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

function wixResult(result: any) {
  return result.valid
    ? { valid: true }
    : {
        valid: false,
        invalidReason: {
          code: result.invalidReason?.code ?? 'BOOKING_RULE_BLOCKED',
          message: result.invalidReason?.message ?? 'This booking does not satisfy the configured booking rules.',
        },
      };
}

function singleResponse(result: any) {
  return { results: [...result.results].sort((a: any, b: any) => a.index - b.index).map(wixResult) };
}

function multiResponse(result: any) {
  return {
    singleServiceBookingResults: [...result.results]
      .sort((a: any, b: any) => a.index - b.index)
      .map(wixResult),
  };
}

bookingsValidation.provideHandlers({
  validateBeforeCreate: (async ({ request }: any) => singleResponse(await handlers.CREATE(request))) as any,
  validateBeforeCancel: (async ({ request }: any) => singleResponse(await handlers.CANCEL(request))) as any,
  validateBeforeReschedule: (async ({ request }: any) => singleResponse(await handlers.RESCHEDULE(request))) as any,
  validateBeforeCreateMultiService: (async ({ request }: any) =>
    multiResponse(await handlers.CREATE_MULTI_SERVICE(request))) as any,
  validateBeforeCancelMultiService: (async ({ request }: any) =>
    multiResponse(await handlers.CANCEL_MULTI_SERVICE(request))) as any,
  validateBeforeRescheduleMultiService: (async ({ request }: any) =>
    multiResponse(await handlers.RESCHEDULE_MULTI_SERVICE(request))) as any,
} as any);
