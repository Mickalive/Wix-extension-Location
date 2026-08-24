/**
 * In-memory fake {@link ScheduleGateway} (Blueprint §3; Contract §8.2, §9).
 *
 * Faithfully models the Calendar V3 behaviors the Technical Contract binds:
 * - snapshots capture full event JSON incl. revisions (§9.1),
 * - CREATE honors UUID idempotency keys (replay => SKIPPED_ALREADY_APPLIED),
 * - UPDATE/CANCEL are revision-checked; stale revisions fail retriable
 *   REVISION_CONFLICT (§9.4),
 * - Cancel Event is terminal: rollback re-creates with a NEW event id and
 *   records a caveat note (§9.6),
 * - verifyApplied re-reads live state and reports drift (§9.5).
 *
 * Test-only fault injection (never used by production code):
 * queueRevisionConflictOnce / failConflictsAlways / crashOnChildIndex /
 * forceVerifyDrift, plus an ordered `trace` for durability-order assertions.
 */
import { SimulatedProcessCrash } from './simulatedProcessCrash';
import type {
  AppliedChangeRecord,
  ApplyResult,
  Instant,
  MutationPlan,
  PlannedChange,
  RollbackResult,
  ScheduleEventRecord,
  ScheduleGateway,
  ScheduleScope,
  ScheduleSnapshot,
  VerifyResult,
} from '../../contracts';

export interface FakeScheduleGatewayOptions {
  now?: () => Instant;
  /** Ordered operation log shared across fakes for before-write assertions. */
  trace?: string[];
}

interface AppliedKeyEntry {
  eventId: string;
}

export class FakeScheduleGateway implements ScheduleGateway {
  private readonly schedules = new Map<string, ScheduleEventRecord[]>();
  private readonly tombstones = new Map<string, ScheduleEventRecord[]>();
  private readonly appliedKeys = new Map<string, AppliedKeyEntry>();
  private readonly conflictOnce = new Set<string>();
  private readonly conflictAlways = new Set<string>();
  private readonly crashAtChangeNumber = new Map<string, number>();
  private readonly verifyDrift = new Map<string, string[]>();
  private readonly changeApplicationsPerPlan = new Map<string, number>();
  private seq = 0;

  private readonly nowFn: () => Instant;
  private readonly trace?: string[];

  constructor(options: FakeScheduleGatewayOptions = {}) {
    this.nowFn = options.now ?? (() => '2026-08-24T12:00:00.000Z');
    this.trace = options.trace;
  }

  // ------------------------------------------------------------- test setup

  seed(scheduleId: string, events: ScheduleEventRecord[]): void {
    this.schedules.set(scheduleId, structuredClone(events));
  }

  /** Live (non-cancelled) events; defensive deep copy. */
  liveEvents(scheduleId: string): ScheduleEventRecord[] {
    return structuredClone(this.liveList(scheduleId));
  }

  /** Events removed via CANCEL_EVENT / rollback removals (terminal cancels). */
  tombstonedEvents(scheduleId: string): ScheduleEventRecord[] {
    return structuredClone(this.tombstones.get(scheduleId) ?? []);
  }

  /** Idempotency keys already consumed by this gateway (replay detection). */
  hasAppliedKey(key: string): boolean {
    return this.appliedKeys.has(key);
  }

  queueRevisionConflictOnce(changeId: string): void {
    this.conflictOnce.add(changeId);
  }

  failConflictsAlways(changeId: string): void {
    this.conflictAlways.add(changeId);
  }

  /**
   * Simulate process death immediately BEFORE the `n`-th change application for
   * this plan, counting across ALL gateway calls (the orchestrator applies one
   * change per call, so n=2 dies just before the second write).
   */
  crashBeforeChangeNumber(planId: string, n: number): void {
    this.crashAtChangeNumber.set(planId, n);
  }

  forceVerifyDrift(planId: string, mismatches: string[]): void {
    this.verifyDrift.set(planId, mismatches);
  }

  resetFaults(): void {
    this.conflictOnce.clear();
    this.conflictAlways.clear();
    this.crashAtChangeNumber.clear();
    this.verifyDrift.clear();
    this.changeApplicationsPerPlan.clear();
  }

  // ------------------------------------------------------------ port methods

  async snapshotWorkingHours(scope: ScheduleScope): Promise<ScheduleSnapshot> {
    this.trace?.push(`gateway.snapshot:${scope.scheduleId}`);
    const events = structuredClone(this.liveList(scope.scheduleId));
    this.seq += 1;
    return {
      snapshotId: `snap-${this.seq.toString().padStart(4, '0')}`,
      takenAt: this.nowFn(),
      scope: { ...scope },
      events,
    };
  }

  async applyWindowChanges(plan: MutationPlan): Promise<ApplyResult> {
    this.trace?.push(`gateway.apply:${plan.planId}`);
    const crashAt = this.crashAtChangeNumber.get(plan.planId);
    const results: AppliedChangeRecord[] = [];
    for (let i = 0; i < plan.changes.length; i++) {
      const change = plan.changes[i];
      if (change === undefined) continue;
      if (crashAt !== undefined) {
        const appliedSoFar = (this.changeApplicationsPerPlan.get(plan.planId) ?? 0) + 1;
        if (appliedSoFar === crashAt) {
          throw new SimulatedProcessCrash(plan.planId, appliedSoFar - 1, change.changeId);
        }
      }
      this.changeApplicationsPerPlan.set(
        plan.planId,
        (this.changeApplicationsPerPlan.get(plan.planId) ?? 0) + 1,
      );
      results.push(this.applyOne(plan, change));
    }
    return {
      planId: plan.planId,
      appliedAt: this.nowFn(),
      results,
      allApplied: results.every((r) => r.status !== 'FAILED'),
    };
  }

  async verifyApplied(plan: MutationPlan): Promise<VerifyResult> {
    this.trace?.push(`gateway.verify:${plan.planId}`);
    const drift = this.verifyDrift.get(plan.planId);
    if (drift) {
      return { planId: plan.planId, verified: false, checkedAt: this.nowFn(), mismatches: [...drift] };
    }
    const mismatches: string[] = [];
    const list = this.liveList(plan.scope.scheduleId);
    for (const change of plan.changes) {
      switch (change.action) {
        case 'CREATE_MASTER': {
          const found = list.some(
            (e) =>
              e.type === 'WORKING_HOURS' &&
              e.recurrence === 'MASTER' &&
              e.weekday === change.weekday &&
              e.startLocalTime === change.startTime &&
              e.endLocalTime === change.endTime &&
              (e.locationId ?? null) === (change.locationId ?? null),
          );
          if (!found) {
            mismatches.push(`missing window ${change.weekday} ${change.startTime}-${change.endTime}`);
          }
          break;
        }
        case 'UPDATE_MASTER': {
          const ev = list.find((e) => e.eventId === change.eventId);
          if (!ev) {
            mismatches.push(`event ${change.eventId} not present after update`);
            break;
          }
          if (change.startTime !== undefined && ev.startLocalTime !== change.startTime) {
            mismatches.push(`event ${change.eventId} start ${ev.startLocalTime} != expected ${change.startTime}`);
          }
          if (change.endTime !== undefined && ev.endLocalTime !== change.endTime) {
            mismatches.push(`event ${change.eventId} end ${ev.endLocalTime ?? '-'} != expected ${change.endTime}`);
          }
          if (change.locationId !== undefined && (ev.locationId ?? null) !== (change.locationId ?? null)) {
            mismatches.push(`event ${change.eventId} location mismatch`);
          }
          break;
        }
        case 'CANCEL_EVENT': {
          if (list.some((e) => e.eventId === change.eventId)) {
            mismatches.push(`event ${change.eventId} still present after cancel`);
          }
          break;
        }
      }
    }
    return { planId: plan.planId, verified: mismatches.length === 0, checkedAt: this.nowFn(), mismatches };
  }

  async rollbackTo(snapshot: ScheduleSnapshot): Promise<RollbackResult> {
    this.trace?.push(`gateway.rollback:${snapshot.snapshotId}`);
    const list = this.liveList(snapshot.scope.scheduleId);
    const tombstoneList = this.tombstoneList(snapshot.scope.scheduleId);
    const snapshotIds = new Set(snapshot.events.map((e) => e.eventId));

    const removedEventIds: string[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const ev = list[i];
      if (ev === undefined) continue;
      if (!snapshotIds.has(ev.eventId)) {
        list.splice(i, 1);
        tombstoneList.push({ ...structuredClone(ev), revision: bump(ev.revision) });
        removedEventIds.push(ev.eventId);
      }
    }

    const restoredEventIds: string[] = [];
    const notes: string[] = [];
    for (const snapEv of snapshot.events) {
      const idx = list.findIndex((e) => e.eventId === snapEv.eventId);
      if (idx >= 0) {
        const liveEv = list[idx];
        if (liveEv === undefined) continue;
        // Untouched events stay byte-identical (no gratuitous revision churn);
        // divergent events are restored from the snapshot content.
        if (!contentEquals(liveEv, snapEv)) {
          list[idx] = { ...structuredClone(snapEv), revision: bump(liveEv.revision) };
        }
        restoredEventIds.push(snapEv.eventId);
      } else {
        const freshId = this.nextEventId();
        list.push({ ...structuredClone(snapEv), eventId: freshId, revision: '1' });
        restoredEventIds.push(freshId);
        notes.push(
          `Event ${snapEv.eventId} had been terminally cancelled; re-created as new event ${freshId} ` +
            '(Cancel Event is terminal per Contract §9.6 — original event id is not recoverable).',
        );
      }
    }
    notes.push('Rollback writes use fresh idempotency keys distinct from apply keys (Contract §9.6).');

    return {
      snapshotId: snapshot.snapshotId,
      rolledBackAt: this.nowFn(),
      restoredEventIds,
      removedEventIds,
      complete: true,
      notes,
    };
  }

  // ----------------------------------------------------------------- internals

  private applyOne(plan: MutationPlan, change: PlannedChange): AppliedChangeRecord {
    if (!change.idempotencyKey) {
      return failed(change, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency key missing', false);
    }
    const key = change.idempotencyKey;
    const existing = this.appliedKeys.get(key);

    if (change.action === 'CREATE_MASTER') {
      if (existing) {
        return skipped(change, existing.eventId);
      }
      const list = this.liveList(plan.scope.scheduleId);
      const event: ScheduleEventRecord = {
        eventId: this.nextEventId(),
        type: 'WORKING_HOURS',
        recurrence: 'MASTER',
        scheduleId: plan.scope.scheduleId,
        startLocalDate: change.anchorDate,
        startLocalTime: change.startTime,
        endLocalTime: change.endTime,
        weekday: change.weekday,
        locationId: change.locationId ?? null,
        revision: '1',
        raw: { source: 'fake-schedule-gateway', idempotencyKey: key },
      };
      list.push(event);
      this.appliedKeys.set(key, { eventId: event.eventId });
      return { changeId: change.changeId, status: 'APPLIED', eventId: event.eventId, revision: '1', attempts: 1 };
    }

    const list = this.liveList(plan.scope.scheduleId);
    const idx = list.findIndex((e) => e.eventId === change.eventId);
    if (idx < 0) {
      // Event already gone (e.g. cancelled by an earlier run): a consumed key
      // still replays as skipped; otherwise this is a hard miss.
      if (existing) return skipped(change, existing.eventId);
      return failed(change, 'NOT_FOUND', `event ${change.eventId} not found on schedule`, false);
    }
    const event = list[idx];
    if (event === undefined) {
      return failed(change, 'INTERNAL_ERROR', 'unreachable: index without element', false);
    }

    // Idempotent replay wins over everything else.
    if (existing) {
      return skipped(change, existing.eventId);
    }

    // Simulated concurrent writers bump the revision before our compare.
    if (this.conflictOnce.has(change.changeId)) {
      this.conflictOnce.delete(change.changeId);
      event.revision = bump(event.revision);
    }
    if (this.conflictAlways.has(change.changeId)) {
      event.revision = bump(event.revision);
    }

    if (event.revision !== change.expectedRevision) {
      return failed(
        change,
        'REVISION_CONFLICT',
        `expected revision ${change.expectedRevision}, current ${event.revision}`,
        true,
      );
    }

    if (change.action === 'UPDATE_MASTER') {
      if (change.startTime !== undefined) event.startLocalTime = change.startTime;
      if (change.endTime !== undefined) event.endLocalTime = change.endTime;
      if (change.locationId !== undefined) event.locationId = change.locationId;
      event.revision = bump(event.revision);
      event.raw = { ...event.raw, lastIdempotencyKey: key };
    } else {
      // CANCEL_EVENT — terminal in the real API; the event leaves the live list.
      list.splice(idx, 1);
      event.revision = bump(event.revision);
      this.tombstoneList(plan.scope.scheduleId).push(structuredClone(event));
    }

    this.appliedKeys.set(key, { eventId: change.eventId });
    return {
      changeId: change.changeId,
      status: 'APPLIED',
      eventId: change.eventId,
      revision: event.revision,
      attempts: 1,
    };
  }

  private liveList(scheduleId: string): ScheduleEventRecord[] {
    let list = this.schedules.get(scheduleId);
    if (!list) {
      list = [];
      this.schedules.set(scheduleId, list);
    }
    return list;
  }

  private tombstoneList(scheduleId: string): ScheduleEventRecord[] {
    let list = this.tombstones.get(scheduleId);
    if (!list) {
      list = [];
      this.tombstones.set(scheduleId, list);
    }
    return list;
  }

  private nextEventId(): string {
    this.seq += 1;
    return `evt-${this.seq.toString().padStart(4, '0')}`;
  }
}

function bump(revision: string): string {
  const n = Number.parseInt(revision, 10);
  return Number.isFinite(n) ? String(n + 1) : `${revision}+1`;
}

/** Revision-independent content equality for event records. */
function contentEquals(a: ScheduleEventRecord, b: ScheduleEventRecord): boolean {
  const strip = (e: ScheduleEventRecord): unknown => {
    const { revision: _rev, ...rest } = e;
    return rest;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function failed(
  change: PlannedChange,
  code: string,
  message: string,
  retriable: boolean,
): AppliedChangeRecord {
  return {
    changeId: change.changeId,
    status: 'FAILED',
    error: { code, message, retriable },
  };
}

function skipped(change: PlannedChange, eventId: string): AppliedChangeRecord {
  return { changeId: change.changeId, status: 'SKIPPED_ALREADY_APPLIED', eventId };
}

export { SimulatedProcessCrash };
