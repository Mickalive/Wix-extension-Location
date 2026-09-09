import type { APIRoute } from 'astro';
import { services, staffMembers } from '@wix/bookings';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import type { MutationPlan, ScheduleScope, Weekday } from '../../shared/types';
import { WixCalendarScheduleGateway } from '../../platform/adapters/scheduleGateway';
import { loadState, saveState, stateItemId } from '../../extensions/backend/runtime/state-store';
import { collectionIdSuffix } from '../../extensions/backend/data-collections/abr-state';

const elevatedQueryServices = auth.elevate((services as any).queryServices);
const elevatedQueryStaffMembers = auth.elevate((staffMembers as any).queryStaffMembers);
const elevatedRemoveItem = auth.elevate((items as any).remove);

const DAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function businessLocationId(location: any): string | null {
  if (String(location?.type ?? '').toUpperCase() !== 'BUSINESS') return null;
  const id = location?.business?._id ?? location?.business?.id;
  return typeof id === 'string' && id ? id : null;
}

function staffRuntime(member: any) {
  const staffMemberId = String(member?._id ?? member?.id ?? '');
  const resourceId = String(member?.resourceId ?? member?.resource?._id ?? member?.resource?.id ?? '');
  const scheduleId = String(member?.resource?.eventsSchedule?._id ?? member?.resource?.eventsSchedule?.id ?? '');
  return staffMemberId && resourceId && scheduleId
    ? { staffMemberId, resourceId, scheduleId }
    : null;
}

function nextDate(weekday: Weekday): string {
  const now = new Date();
  const target = DAYS.indexOf(weekday);
  const delta = ((target - now.getUTCDay() + 7) % 7) + 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta))
    .toISOString()
    .slice(0, 10);
}

function eventSignature(event: any): string {
  return [
    event.weekday ?? '',
    event.startLocalTime ?? '',
    event.endLocalTime ?? '',
    event.locationId ?? '',
  ].join('|');
}

export const GET: APIRoute = async ({ request }) => {
  if (process.env.ABR_FUNCTIONAL_SMOKE !== '1' || request.headers.get('x-abr-functional-smoke') !== 'local-dev-only') {
    return json({ error: 'NOT_FOUND' }, 404);
  }

  const smokeInstance = `functional-smoke-${crypto.randomUUID()}`;
  const stateKey = 'probe';
  let stateSaved = false;
  let snapshot: any = null;
  let gateway: WixCalendarScheduleGateway | null = null;
  let rollback: any = null;

  try {
    const nonce = crypto.randomUUID();
    await saveState(smokeInstance, stateKey, 'degradation', { nonce });
    stateSaved = true;
    const loaded = await loadState<{ nonce: string }>(smokeInstance, stateKey);
    if (loaded?.nonce !== nonce) {
      return json({ ok: false, stage: 'wix-data', error: 'ROUND_TRIP_MISMATCH' }, 500);
    }

    const serviceResponse: any = await (elevatedQueryServices as any)({
      filter: { type: { $eq: 'APPOINTMENT' } },
      cursorPaging: { limit: 100 },
    });
    const appointmentServices = Array.isArray(serviceResponse?.services) ? serviceResponse.services : [];

    let candidate: { resourceId: string; locationId: string } | null = null;
    for (const service of appointmentServices) {
      const resourceIds = Array.isArray(service?.staffMemberIds)
        ? service.staffMemberIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];
      const locationId = (Array.isArray(service?.locations) ? service.locations : [])
        .map(businessLocationId)
        .find((id: string | null): id is string => Boolean(id));
      if (resourceIds[0] && locationId) {
        candidate = { resourceId: resourceIds[0], locationId };
        break;
      }
    }

    if (!candidate) {
      return json({
        ok: false,
        stage: 'bookings-data',
        error: 'NO_APPOINTMENT_WITH_STAFF_AND_BUSINESS_LOCATION',
        appointmentServiceCount: appointmentServices.length,
        wixDataRoundTrip: true,
      }, 409);
    }

    const staffResponse: any = await (elevatedQueryStaffMembers as any)(
      {
        filter: { resourceId: { $eq: candidate.resourceId } },
        cursorPaging: { limit: 10 },
      },
      { fields: ['RESOURCE_DETAILS'] },
    );
    const members = Array.isArray(staffResponse?.staffMembers) ? staffResponse.staffMembers : [];
    const staff = members.map(staffRuntime).find(Boolean) as ReturnType<typeof staffRuntime>;
    if (!staff) {
      return json({
        ok: false,
        stage: 'bookings-staff',
        error: 'NO_STAFF_RUNTIME_FOR_SERVICE_RESOURCE',
        wixDataRoundTrip: true,
      }, 409);
    }

    const scope: ScheduleScope = {
      scheduleId: staff.scheduleId,
      ownerType: 'STAFF',
      ownerId: staff.resourceId,
      locationId: candidate.locationId,
    };

    gateway = new WixCalendarScheduleGateway();
    snapshot = await gateway.snapshotWorkingHours(scope);
    const before = [...snapshot.events].map(eventSignature).sort();

    const weekday: Weekday = DAYS[(new Date().getUTCDay() + 2) % 7];
    const plan: MutationPlan = {
      planId: `functional-smoke-${crypto.randomUUID()}`,
      scope,
      ruleVersion: 999999,
      changes: [
        {
          changeId: 'functional-smoke-create',
          action: 'CREATE_MASTER',
          weekday,
          startTime: '03:17',
          endTime: '03:29',
          anchorDate: nextDate(weekday),
          locationId: candidate.locationId,
          idempotencyKey: crypto.randomUUID(),
        },
      ],
      createdAt: new Date().toISOString(),
      createdBy: 'functional-smoke',
      reason: 'Temporary end-to-end Wix Calendar verification on development site',
    };

    const applied = await gateway.applyWindowChanges(plan);
    const verified = await gateway.verifyApplied(plan);
    rollback = await gateway.rollbackTo(snapshot);
    const afterSnapshot = await gateway.snapshotWorkingHours(scope);
    const after = [...afterSnapshot.events].map(eventSignature).sort();
    const restored = JSON.stringify(before) === JSON.stringify(after);

    const ok = applied.allApplied && verified.verified && rollback.complete && restored;
    return json({
      ok,
      wixDataRoundTrip: true,
      appointmentServiceCount: appointmentServices.length,
      calendar: {
        applied: applied.allApplied,
        verified: verified.verified,
        rollbackComplete: rollback.complete,
        restored,
        appliedResults: applied.results.map((row) => ({ changeId: row.changeId, status: row.status })),
        mismatches: verified.mismatches,
        rollbackNotes: rollback.notes,
      },
    }, ok ? 200 : 500);
  } catch (error) {
    if (gateway && snapshot && !rollback) {
      try {
        rollback = await gateway.rollbackTo(snapshot);
      } catch {
        // Preserve the original failure; this endpoint exists only for local diagnostics.
      }
    }
    return json({
      ok: false,
      stage: 'exception',
      error: error instanceof Error ? error.message : String(error),
      rollbackAttempted: Boolean(gateway && snapshot),
      rollbackComplete: rollback?.complete ?? null,
    }, 500);
  } finally {
    if (stateSaved) {
      try {
        await (elevatedRemoveItem as any)(collectionIdSuffix, stateItemId(smokeInstance, stateKey));
      } catch {
        // Diagnostic cleanup failure must not hide the functional result.
      }
    }
  }
};
