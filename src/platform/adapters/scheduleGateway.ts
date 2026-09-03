import { events } from '@wix/calendar';
import { auth } from '@wix/essentials';
import type {
  ApplyResult,
  MutationPlan,
  PlannedChange,
  RollbackResult,
  ScheduleEventRecord,
  ScheduleGateway,
  ScheduleScope,
  ScheduleSnapshot,
  VerifyResult,
  Weekday,
} from '../../domain/ports';

const MANAGED_TITLE_PREFIX = 'Advanced Booking Rules · ';
const BOOKING_APP_ID = '13d21c63-b5ec-5912-8397-c3a5ddb27a97';
const elevatedQueryEvents = auth.elevate(events.queryEvents);
const elevatedCreateEvent = auth.elevate(events.createEvent);
const elevatedUpdateEvent = auth.elevate(events.updateEvent);
const elevatedCancelEvent = auth.elevate(events.cancelEvent);

const FULL_DAY: Record<Weekday, string> = {
  MON: 'MONDAY',
  TUE: 'TUESDAY',
  WED: 'WEDNESDAY',
  THU: 'THURSDAY',
  FRI: 'FRIDAY',
  SAT: 'SATURDAY',
  SUN: 'SUNDAY',
};
const SHORT_DAY: Record<string, Weekday> = Object.fromEntries(
  Object.entries(FULL_DAY).map(([short, full]) => [full, short]),
) as Record<string, Weekday>;

function nowIso(): string {
  return new Date().toISOString();
}

function localDate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function localTime(value: unknown): string {
  return typeof value === 'string' && value.length >= 16 ? value.slice(11, 16) : '';
}

function eventId(event: any): string {
  return String(event?._id ?? event?.id ?? '');
}

function recurrence(event: any): ScheduleEventRecord['recurrence'] {
  const value = String(event?.recurrenceType ?? '');
  if (value === 'MASTER') return 'MASTER';
  if (value === 'INSTANCE' || value === 'EXCEPTION') return 'INSTANCE';
  return 'ONE_TIME';
}

function isManaged(event: any): boolean {
  return typeof event?.title === 'string' && event.title.startsWith(MANAGED_TITLE_PREFIX);
}

function mapEvent(scope: ScheduleScope, event: any): ScheduleEventRecord {
  const day = event?.recurrenceRule?.days?.[0];
  return {
    eventId: eventId(event),
    type: String(event?.type ?? 'DEFAULT'),
    recurrence: recurrence(event),
    scheduleId: String(event?.scheduleId ?? scope.scheduleId),
    startLocalDate: localDate(event?.start?.localDate),
    startLocalTime: localTime(event?.start?.localDate),
    ...(localTime(event?.end?.localDate) ? { endLocalTime: localTime(event?.end?.localDate) } : {}),
    ...(SHORT_DAY[String(day)] ? { weekday: SHORT_DAY[String(day)] } : {}),
    locationId: event?.location?.id ?? null,
    revision: String(event?.revision ?? ''),
    raw: JSON.parse(JSON.stringify(event ?? {})),
  };
}

async function queryManaged(scope: ScheduleScope): Promise<any[]> {
  const response: any = await (elevatedQueryEvents as any)(
    {
      filter: {
        externalScheduleId: { $eq: scope.ownerId },
        type: { $eq: 'WORKING_HOURS' },
      },
      cursorPaging: { limit: 1000 },
    },
    { recurrenceType: ['MASTER'] },
  );
  const rows = Array.isArray(response?.events) ? response.events : Array.isArray(response?.items) ? response.items : [];
  return rows.filter(isManaged);
}

function managedEventFor(scope: ScheduleScope, change: Extract<PlannedChange, { action: 'CREATE_MASTER' }>): any {
  return {
    scheduleId: scope.scheduleId,
    externalScheduleId: scope.ownerId,
    appId: BOOKING_APP_ID,
    type: 'WORKING_HOURS',
    title: `${MANAGED_TITLE_PREFIX}${change.locationId ?? 'default'}`,
    start: { localDate: `${change.anchorDate}T${change.startTime}:00` },
    end: { localDate: `${change.anchorDate}T${change.endTime}:00` },
    recurrenceRule: {
      frequency: 'WEEKLY',
      interval: 1,
      days: [FULL_DAY[change.weekday]],
    },
    ...(change.locationId
      ? { location: { id: change.locationId, type: 'BUSINESS' } }
      : {}),
    resources: [{ id: scope.ownerId }],
  };
}

function failure(changeId: string, error: any) {
  const message = error instanceof Error ? error.message : String(error);
  const revision = /revision|conflict|precondition/i.test(message);
  return {
    changeId,
    status: 'FAILED' as const,
    error: {
      code: revision ? 'REVISION_CONFLICT' : 'WIX_CALENDAR_WRITE_FAILED',
      message,
      retriable: revision,
    },
  };
}

export class WixCalendarScheduleGateway implements ScheduleGateway {
  async snapshotWorkingHours(scope: ScheduleScope): Promise<ScheduleSnapshot> {
    const rows = await queryManaged(scope);
    return {
      snapshotId: crypto.randomUUID(),
      takenAt: nowIso(),
      scope,
      events: rows.map((event) => mapEvent(scope, event)),
    };
  }

  async applyWindowChanges(plan: MutationPlan): Promise<ApplyResult> {
    const results: ApplyResult['results'] = [];
    for (const change of plan.changes) {
      try {
        if (change.action === 'CREATE_MASTER') {
          const created: any = await (elevatedCreateEvent as any)(
            managedEventFor(plan.scope, change),
            { idempotencyKey: change.idempotencyKey },
          );
          const entity = created?.event ?? created;
          results.push({
            changeId: change.changeId,
            status: 'APPLIED',
            eventId: eventId(entity) || undefined,
            revision: entity?.revision ? String(entity.revision) : undefined,
          });
          continue;
        }

        if (change.action === 'UPDATE_MASTER') {
          const current: any = await this.findEvent(plan.scope, change.eventId);
          if (!current) {
            results.push(failure(change.changeId, new Error(`event ${change.eventId} not found`)));
            continue;
          }
          if (String(current.revision ?? '') !== String(change.expectedRevision)) {
            results.push(failure(change.changeId, new Error('revision conflict')));
            continue;
          }
          const patched = {
            ...current,
            ...(change.startTime
              ? { start: { ...current.start, localDate: `${localDate(current.start?.localDate)}T${change.startTime}:00` } }
              : {}),
            ...(change.endTime
              ? { end: { ...current.end, localDate: `${localDate(current.end?.localDate)}T${change.endTime}:00` } }
              : {}),
            ...(change.locationId !== undefined
              ? { location: change.locationId ? { id: change.locationId, type: 'BUSINESS' } : undefined }
              : {}),
          };
          const updated: any = await (elevatedUpdateEvent as any)(patched);
          const entity = updated?.event ?? updated;
          results.push({
            changeId: change.changeId,
            status: 'APPLIED',
            eventId: eventId(entity) || change.eventId,
            revision: entity?.revision ? String(entity.revision) : undefined,
          });
          continue;
        }

        const current: any = await this.findEvent(plan.scope, change.eventId);
        if (!current || String(current.status ?? '').toUpperCase() === 'CANCELLED') {
          results.push({ changeId: change.changeId, status: 'SKIPPED_ALREADY_APPLIED', eventId: change.eventId });
          continue;
        }
        if (String(current.revision ?? '') !== String(change.expectedRevision)) {
          results.push(failure(change.changeId, new Error('revision conflict')));
          continue;
        }
        await (elevatedCancelEvent as any)(change.eventId);
        results.push({ changeId: change.changeId, status: 'APPLIED', eventId: change.eventId });
      } catch (error) {
        results.push(failure(change.changeId, error));
      }
    }
    return {
      planId: plan.planId,
      appliedAt: nowIso(),
      results,
      allApplied: results.every((entry) => entry.status !== 'FAILED'),
    };
  }

  async verifyApplied(plan: MutationPlan): Promise<VerifyResult> {
    const rows = await queryManaged(plan.scope);
    const mapped = rows.map((event) => mapEvent(plan.scope, event));
    const mismatches: string[] = [];
    for (const change of plan.changes) {
      if (change.action === 'CANCEL_EVENT') {
        if (mapped.some((event) => event.eventId === change.eventId)) {
          mismatches.push(`cancelled event still present: ${change.eventId}`);
        }
        continue;
      }
      if (change.action === 'CREATE_MASTER') {
        const found = mapped.some(
          (event) =>
            event.weekday === change.weekday &&
            event.startLocalTime === change.startTime &&
            event.endLocalTime === change.endTime &&
            (event.locationId ?? null) === (change.locationId ?? null),
        );
        if (!found) mismatches.push(`created window missing: ${change.weekday} ${change.startTime}-${change.endTime} ${change.locationId ?? ''}`);
      }
    }
    return { planId: plan.planId, verified: mismatches.length === 0, checkedAt: nowIso(), mismatches };
  }

  async rollbackTo(snapshot: ScheduleSnapshot): Promise<RollbackResult> {
    const notes: string[] = [];
    const current = await queryManaged(snapshot.scope);
    const removedEventIds: string[] = [];
    const restoredEventIds: string[] = [];

    for (const event of current) {
      const id = eventId(event);
      if (!id) continue;
      try {
        await (elevatedCancelEvent as any)(id);
        removedEventIds.push(id);
      } catch (error) {
        notes.push(`Could not cancel managed event ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const event of snapshot.events) {
      if (event.recurrence !== 'MASTER' || !event.weekday || !event.endLocalTime) continue;
      try {
        const created: any = await (elevatedCreateEvent as any)(
          managedEventFor(snapshot.scope, {
            changeId: `rollback-${event.eventId}`,
            action: 'CREATE_MASTER',
            weekday: event.weekday,
            startTime: event.startLocalTime,
            endTime: event.endLocalTime,
            anchorDate: event.startLocalDate,
            locationId: event.locationId,
          }),
          { idempotencyKey: crypto.randomUUID() },
        );
        restoredEventIds.push(eventId(created?.event ?? created));
      } catch (error) {
        notes.push(`Could not restore ${event.weekday} ${event.startLocalTime}-${event.endLocalTime}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      snapshotId: snapshot.snapshotId,
      rolledBackAt: nowIso(),
      restoredEventIds: restoredEventIds.filter(Boolean),
      removedEventIds,
      complete: notes.length === 0,
      notes,
    };
  }

  private async findEvent(scope: ScheduleScope, id: string): Promise<any | null> {
    const rows = await queryManaged(scope);
    return rows.find((event) => eventId(event) === id) ?? null;
  }
}

export { MANAGED_TITLE_PREFIX };
