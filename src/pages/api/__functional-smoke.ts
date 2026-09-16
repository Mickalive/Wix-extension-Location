import type { APIRoute } from 'astro';
import type { MutationPlan, ScheduleScope, Weekday } from '../../shared/types';

const DAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const PREVIEW_SMOKE_HEADER = 'preview-e2e-2026-09-16';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 6) : [],
    };
  }
  return { name: 'UnknownError', message: String(error), stack: [] };
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
  if (request.headers.get('x-abr-functional-smoke') !== PREVIEW_SMOKE_HEADER) {
    return json({ error: 'NOT_FOUND' }, 404);
  }

  let auth: any;
  try {
    const essentials = await import('@wix/essentials');
    auth = essentials.auth;
    if (!auth || typeof auth.getTokenInfo !== 'function' || typeof auth.elevate !== 'function') {
      return json({ ok: false, stage: 'essentials-shape', exports: Object.keys(essentials ?? {}) }, 500);
    }
  } catch (error) {
    return json({ ok: false, stage: 'essentials-import', error: errorDetails(error) }, 500);
  }

  let instanceId: string | null = null;
  try {
    const tokenInfo = await auth.getTokenInfo();
    instanceId = typeof tokenInfo?.instanceId === 'string' && tokenInfo.instanceId ? tokenInfo.instanceId : null;
    if (!instanceId) {
      return json({ ok: false, stage: 'auth-token', error: 'MISSING_INSTANCE_ID', tokenKeys: Object.keys(tokenInfo ?? {}) }, 401);
    }
  } catch (error) {
    return json({ ok: false, stage: 'auth-token', error: errorDetails(error) }, 500);
  }

  let items: any;
  try {
    const dataModule = await import('@wix/data');
    items = dataModule.items;
    if (!items) {
      return json({ ok: false, stage: 'wix-data-shape', exports: Object.keys(dataModule ?? {}) }, 500);
    }
  } catch (error) {
    return json({ ok: false, stage: 'wix-data-import', error: errorDetails(error) }, 500);
  }

  let stateStore: any;
  let collectionIdSuffix = '';
  try {
    stateStore = await import('../../extensions/backend/runtime/state-store');
    const collectionSchema = await import('../../extensions/backend/data-collections/abr-state');
    collectionIdSuffix = collectionSchema.collectionIdSuffix;
  } catch (error) {
    return json({
      ok: false,
      stage: 'state-store-import',
      error: errorDetails(error),
      wixDataMethods: Object.keys(items ?? {}).sort(),
    }, 500);
  }

  const smokeInstance = `${instanceId}-functional-smoke-${crypto.randomUUID()}`;
  const stateKey = 'probe';
  let stateSaved = false;
  let elevatedRemoveItem: any = null;
  try {
    elevatedRemoveItem = auth.elevate(items.remove);
    const nonce = crypto.randomUUID();
    await stateStore.saveState(smokeInstance, stateKey, 'degradation', { nonce });
    stateSaved = true;
    const loaded = await stateStore.loadState(smokeInstance, stateKey);
    if (loaded?.nonce !== nonce) {
      return json({
        ok: false,
        stage: 'wix-data-roundtrip',
        error: 'ROUND_TRIP_MISMATCH',
        collectionIdSuffix,
        wixDataMethods: Object.keys(items ?? {}).sort(),
      }, 500);
    }
  } catch (error) {
    return json({
      ok: false,
      stage: 'wix-data-roundtrip',
      error: errorDetails(error),
      collectionIdSuffix,
      wixDataMethods: Object.keys(items ?? {}).sort(),
    }, 500);
  }

  let services: any;
  let staffMembers: any;
  let elevatedQueryServices: any;
  let elevatedQueryStaffMembers: any;
  try {
    const bookings = await import('@wix/bookings');
    services = bookings.services;
    staffMembers = bookings.staffMembers;
    elevatedQueryServices = auth.elevate(services?.queryServices);
    elevatedQueryStaffMembers = auth.elevate(staffMembers?.queryStaffMembers);
  } catch (error) {
    return json({ ok: false, stage: 'bookings-import', error: errorDetails(error), wixDataRoundTrip: true }, 500);
  }

  let appointmentServices: any[] = [];
  let candidate: { resourceId: string; locationId: string } | null = null;
  try {
    const serviceResponse: any = await elevatedQueryServices({
      filter: { type: { $eq: 'APPOINTMENT' } },
      cursorPaging: { limit: 100 },
    });
    appointmentServices = Array.isArray(serviceResponse?.services) ? serviceResponse.services : [];

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
  } catch (error) {
    return json({ ok: false, stage: 'bookings-services-query', error: errorDetails(error), wixDataRoundTrip: true }, 500);
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

  let staff: ReturnType<typeof staffRuntime> = null;
  try {
    const staffResponse: any = await elevatedQueryStaffMembers(
      {
        filter: { resourceId: { $eq: candidate.resourceId } },
        cursorPaging: { limit: 10 },
      },
      { fields: ['RESOURCE_DETAILS'] },
    );
    const members = Array.isArray(staffResponse?.staffMembers) ? staffResponse.staffMembers : [];
    staff = members.map(staffRuntime).find(Boolean) ?? null;
  } catch (error) {
    return json({ ok: false, stage: 'bookings-staff-query', error: errorDetails(error), wixDataRoundTrip: true }, 500);
  }

  if (!staff) {
    return json({
      ok: false,
      stage: 'bookings-staff',
      error: 'NO_STAFF_RUNTIME_FOR_SERVICE_RESOURCE',
      wixDataRoundTrip: true,
    }, 409);
  }

  let gateway: any = null;
  let snapshot: any = null;
  let rollback: any = null;
  try {
    const gatewayModule = await import('../../platform/adapters/scheduleGateway');
    gateway = new gatewayModule.WixCalendarScheduleGateway();
  } catch (error) {
    return json({ ok: false, stage: 'calendar-gateway-import', error: errorDetails(error), wixDataRoundTrip: true }, 500);
  }

  try {
    const scope: ScheduleScope = {
      scheduleId: staff.scheduleId,
      ownerType: 'STAFF',
      ownerId: staff.resourceId,
      locationId: candidate.locationId,
    };

    snapshot = await gateway.snapshotWorkingHours(scope);
    const before = [...snapshot.events].map(eventSignature).sort();

    const weekday = DAYS[(new Date().getUTCDay() + 2) % 7]!;
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
      stage: ok ? 'complete' : 'calendar-verification',
      wixDataRoundTrip: true,
      appointmentServiceCount: appointmentServices.length,
      calendar: {
        applied: applied.allApplied,
        verified: verified.verified,
        rollbackComplete: rollback.complete,
        restored,
        appliedResults: applied.results.map((row: any) => ({ changeId: row.changeId, status: row.status })),
        mismatches: verified.mismatches,
        rollbackNotes: rollback.notes,
      },
    }, ok ? 200 : 500);
  } catch (error) {
    if (gateway && snapshot && !rollback) {
      try {
        rollback = await gateway.rollbackTo(snapshot);
      } catch {
        // Preserve the original failure.
      }
    }
    return json({
      ok: false,
      stage: 'calendar-operation',
      error: errorDetails(error),
      wixDataRoundTrip: true,
      rollbackAttempted: Boolean(gateway && snapshot),
      rollbackComplete: rollback?.complete ?? null,
    }, 500);
  } finally {
    if (stateSaved && elevatedRemoveItem) {
      try {
        await elevatedRemoveItem(collectionIdSuffix, stateStore.stateItemId(smokeInstance, stateKey));
      } catch {
        // Cleanup failure must not hide the functional result.
      }
    }
  }
};
