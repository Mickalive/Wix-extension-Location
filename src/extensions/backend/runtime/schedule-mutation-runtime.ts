import { services, staffMembers } from '@wix/bookings';
import { auth } from '@wix/essentials';
import type {
  MutationPlan,
  PlannedChange,
  RuleSetDTO,
  ScheduleScope,
  ScheduleSnapshot,
  Weekday,
} from '../../../domain/ports';
import { ScheduleMutationOrchestrator } from '../../../platform/schedule-mutation/orchestrator';
import { WixCalendarScheduleGateway } from '../../../platform/adapters/scheduleGateway';
import { computeScheduleDiff } from '../../../ui/diff/computeScheduleDiff.js';
import { ruleSetDtoToDraft } from '../../../ui/services/ruleSetRuntime.js';
import { loadState, saveState } from './state-store';
import { WixDataMutationJournal } from './mutation-journal';

const elevatedQueryServices = auth.elevate((services as any).queryServices);
const elevatedQueryStaffMembers = auth.elevate((staffMembers as any).queryStaffMembers);
const elevatedAssignWorkingHoursSchedule = auth.elevate((staffMembers as any).assignWorkingHoursSchedule);

const DAY_NUMBER: Record<Weekday, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

interface StaffRuntime {
  staffMemberId: string;
  resourceId: string;
  eventsScheduleId: string;
  usesDefaultWorkingHours: boolean;
  previousWorkingHoursScheduleId: string | null;
}

interface AggregateMutationState {
  planId: string;
  state: 'APPLY_IN_PROGRESS' | 'APPLY_COMPLETED' | 'ROLLED_BACK' | 'RECOVERED';
  scope: ScheduleScope;
  confirmedChangeIds: string[];
  totalChanges: number;
  updatedAt: string;
  snapshotId: string;
  childPlanIds: string[];
  childScopes: ScheduleScope[];
  error?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextAnchorDate(weekday: Weekday): string {
  const now = new Date();
  const target = DAY_NUMBER[weekday];
  const delta = (target - now.getUTCDay() + 7) % 7;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta));
  return date.toISOString().slice(0, 10);
}

function businessLocationId(location: any): string | null {
  if (String(location?.type ?? '').toUpperCase() !== 'BUSINESS') return null;
  const value = location?.business?._id ?? location?.business?.id;
  return typeof value === 'string' && value ? value : null;
}

async function listAppointmentServices(): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const response: any = await (elevatedQueryServices as any)({
      filter: { type: { $eq: 'APPOINTMENT' } },
      cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    const batch = Array.isArray(response?.services) ? response.services : [];
    rows.push(...batch);
    const next = response?.pagingMetadata?.cursors?.next ?? response?.metadata?.cursors?.next;
    if (typeof next !== 'string' || next === '' || batch.length === 0) break;
    cursor = next;
  }
  return rows;
}

async function mapResourcesByLocation(locationIds: Set<string>): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const id of locationIds) result.set(id, new Set());
  const allServices = await listAppointmentServices();
  for (const service of allServices) {
    const resourceIds = Array.isArray(service?.staffMemberIds)
      ? service.staffMemberIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (resourceIds.length === 0) continue;
    for (const location of Array.isArray(service?.locations) ? service.locations : []) {
      const locationId = businessLocationId(location);
      if (!locationId || !locationIds.has(locationId)) continue;
      const bucket = result.get(locationId) ?? new Set<string>();
      for (const resourceId of resourceIds) bucket.add(resourceId);
      result.set(locationId, bucket);
    }
  }
  return result;
}

function staffId(member: any): string {
  return String(member?._id ?? member?.id ?? '');
}

function staffRuntime(member: any): StaffRuntime | null {
  const staffMemberId = staffId(member);
  const resourceId = String(member?.resourceId ?? member?.resource?._id ?? member?.resource?.id ?? '');
  const eventsScheduleId = String(member?.resource?.eventsSchedule?._id ?? member?.resource?.eventsSchedule?.id ?? '');
  if (!staffMemberId || !resourceId || !eventsScheduleId) return null;
  const schedules = Array.isArray(member?.resource?.workingHoursSchedules)
    ? member.resource.workingHoursSchedules
    : Array.isArray(member?.workingHoursSchedules)
      ? member.workingHoursSchedules
      : [];
  const previous = schedules[0]?._id ?? schedules[0]?.id ?? null;
  return {
    staffMemberId,
    resourceId,
    eventsScheduleId,
    usesDefaultWorkingHours: member?.resource?.usesDefaultWorkingHours === true || member?.usesDefaultWorkingHours === true,
    previousWorkingHoursScheduleId: typeof previous === 'string' && previous ? previous : null,
  };
}

async function loadStaffByResourceIds(resourceIds: Set<string>): Promise<Map<string, StaffRuntime>> {
  const result = new Map<string, StaffRuntime>();
  const ids = [...resourceIds];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const response: any = await (elevatedQueryStaffMembers as any)(
      {
        filter: { resourceId: { $in: chunk } },
        cursorPaging: { limit: 100 },
      },
      { fields: ['RESOURCE_DETAILS'] },
    );
    const members = Array.isArray(response?.staffMembers) ? response.staffMembers : [];
    for (const member of members) {
      const runtime = staffRuntime(member);
      if (runtime) result.set(runtime.resourceId, runtime);
    }
  }
  return result;
}

async function assignSchedule(staff: StaffRuntime, scheduleId: string): Promise<void> {
  await (elevatedAssignWorkingHoursSchedule as any)(staff.staffMemberId, scheduleId, {
    fields: ['RESOURCE_DETAILS'],
  });
}

function signature(input: { weekday?: string; startLocalTime?: string; endLocalTime?: string; locationId?: string | null }): string {
  return [input.weekday ?? '', input.startLocalTime ?? '', input.endLocalTime ?? '', input.locationId ?? ''].join('|');
}

function desiredForLocations(ruleSet: RuleSetDTO, locations: Set<string>) {
  const desired: Array<{ weekday: Weekday; start: string; end: string; locationId: string }> = [];
  for (const locationId of [...locations].sort()) {
    for (const row of ruleSet.locationWindows?.[locationId] ?? []) {
      desired.push({ weekday: row.weekday, start: row.start, end: row.end, locationId });
    }
  }
  return desired;
}

function buildChanges(snapshot: ScheduleSnapshot, ruleSet: RuleSetDTO, affectedLocations: Set<string>): PlannedChange[] {
  const desired = desiredForLocations(ruleSet, affectedLocations);
  const existing = snapshot.events.filter(
    (event) => event.recurrence === 'MASTER' && typeof event.locationId === 'string' && affectedLocations.has(event.locationId),
  );

  const desiredCounts = new Map<string, number>();
  for (const row of desired) {
    const key = signature({ weekday: row.weekday, startLocalTime: row.start, endLocalTime: row.end, locationId: row.locationId });
    desiredCounts.set(key, (desiredCounts.get(key) ?? 0) + 1);
  }
  const existingCounts = new Map<string, number>();
  for (const event of existing) {
    const key = signature(event);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const changes: PlannedChange[] = [];
  const retained = new Map<string, number>();
  for (const event of existing) {
    const key = signature(event);
    const allowed = desiredCounts.get(key) ?? 0;
    const used = retained.get(key) ?? 0;
    if (used < allowed) {
      retained.set(key, used + 1);
      continue;
    }
    changes.push({
      changeId: `cancel-${event.eventId}`,
      action: 'CANCEL_EVENT',
      eventId: event.eventId,
      expectedRevision: event.revision,
    });
  }

  const consumed = new Map<string, number>();
  for (const row of desired) {
    const key = signature({ weekday: row.weekday, startLocalTime: row.start, endLocalTime: row.end, locationId: row.locationId });
    const available = existingCounts.get(key) ?? 0;
    const used = consumed.get(key) ?? 0;
    if (used < available) {
      consumed.set(key, used + 1);
      continue;
    }
    changes.push({
      changeId: `create-${row.locationId}-${row.weekday}-${row.start}-${row.end}`,
      action: 'CREATE_MASTER',
      weekday: row.weekday,
      startTime: row.start,
      endTime: row.end,
      anchorDate: nextAnchorDate(row.weekday),
      locationId: row.locationId,
    });
  }
  return changes;
}

function affectedLocationIds(active: RuleSetDTO | null, draft: RuleSetDTO): Set<string> {
  const diff = computeScheduleDiff(ruleSetDtoToDraft(active), ruleSetDtoToDraft(draft));
  const locations = new Set<string>();
  for (const op of diff.ops as any[]) {
    if ((op.kind === 'ADD_WINDOW' || op.kind === 'REMOVE_WINDOW') && op.scopeType === 'location' && typeof op.scopeId === 'string') {
      locations.add(op.scopeId);
    }
  }
  return locations;
}

function aggregateProjection(
  planId: string,
  state: AggregateMutationState['state'],
  scope: ScheduleScope,
  totalChanges: number,
  confirmedChangeIds: string[],
  childPlanIds: string[],
  childScopes: ScheduleScope[],
  snapshotId: string,
  error?: string | null,
): AggregateMutationState {
  return {
    planId,
    state,
    scope,
    confirmedChangeIds,
    totalChanges,
    updatedAt: nowIso(),
    snapshotId,
    childPlanIds,
    childScopes,
    ...(error ? { error } : {}),
  };
}

export async function applyConfirmedRules(instanceId: string, confirmedDiffHash: string) {
  const active = await loadState<RuleSetDTO>(instanceId, 'active-ruleset');
  const draft = await loadState<RuleSetDTO>(instanceId, 'draft-ruleset');
  if (!draft) throw new Error('NO_DRAFT_RULESET');

  const diff = computeScheduleDiff(ruleSetDtoToDraft(active), ruleSetDtoToDraft(draft));
  if (diff.hash !== confirmedDiffHash) {
    throw new Error(`CONFIRMED_DIFF_MISMATCH:${diff.hash}`);
  }

  const parentPlanId = crypto.randomUUID();
  const affectedLocations = affectedLocationIds(active, draft);
  const resourcesByLocation = await mapResourcesByLocation(affectedLocations);
  const allResourceIds = new Set<string>();
  for (const resources of resourcesByLocation.values()) {
    for (const resourceId of resources) allResourceIds.add(resourceId);
  }
  const staffByResource = await loadStaffByResourceIds(allResourceIds);
  const locationsByResource = new Map<string, Set<string>>();
  for (const [locationId, resources] of resourcesByLocation) {
    for (const resourceId of resources) {
      const bucket = locationsByResource.get(resourceId) ?? new Set<string>();
      bucket.add(locationId);
      locationsByResource.set(resourceId, bucket);
    }
  }

  const gateway = new WixCalendarScheduleGateway();
  const journal = new WixDataMutationJournal(instanceId);
  const clock = { now: () => nowIso(), zone: () => 'UTC' };
  const childPlanIds: string[] = [];
  const childScopes: ScheduleScope[] = [];
  const aggregateConfirmed: string[] = [];
  const preSnapshots: Array<{ scope: ScheduleScope; snapshot: ScheduleSnapshot }> = [];
  const changedAssignments: StaffRuntime[] = [];
  const childPlans: MutationPlan[] = [];

  for (const [resourceId, locations] of locationsByResource) {
    const staff = staffByResource.get(resourceId);
    if (!staff) continue;
    const scope: ScheduleScope = {
      scheduleId: staff.eventsScheduleId,
      ownerType: 'STAFF',
      ownerId: staff.resourceId,
    };
    const snapshot = await gateway.snapshotWorkingHours(scope);
    const changes = buildChanges(snapshot, draft, locations);
    if (changes.length === 0) continue;
    preSnapshots.push({ scope, snapshot });
    childScopes.push(scope);
    const plan: MutationPlan = {
      planId: crypto.randomUUID(),
      scope,
      ruleVersion: draft.version,
      changes,
      createdAt: nowIso(),
      createdBy: 'dashboard-user',
      reason: `Confirmed Advanced Booking Rules diff ${confirmedDiffHash}`,
    };
    childPlans.push(plan);
    childPlanIds.push(plan.planId);
  }

  const totalChanges = childPlans.reduce((sum, plan) => sum + plan.changes.length, 0);
  const statusScope = childScopes[0] ?? {
    scheduleId: 'rules-only',
    ownerType: 'BUSINESS' as const,
    ownerId: 'rules-only',
  };
  const aggregateSnapshotId = preSnapshots[0]?.snapshot.snapshotId ?? crypto.randomUUID();
  await saveState(
    instanceId,
    `mutation-${parentPlanId}`,
    'mutation',
    aggregateProjection(parentPlanId, 'APPLY_IN_PROGRESS', statusScope, totalChanges, [], childPlanIds, childScopes, aggregateSnapshotId),
  );

  try {
    for (const plan of childPlans) {
      const staff = staffByResource.get(plan.scope.ownerId);
      if (!staff) throw new Error(`STAFF_RESOURCE_NOT_FOUND:${plan.scope.ownerId}`);
      if (staff.usesDefaultWorkingHours) {
        await assignSchedule(staff, staff.eventsScheduleId);
        changedAssignments.push(staff);
      }
      const orchestrator = new ScheduleMutationOrchestrator({
        gateway,
        journal,
        clock,
        siteId: instanceId,
        actor: 'advanced-booking-rules-runtime',
      });
      const summary = await orchestrator.applyPlan(plan);
      if (summary.status !== 'APPLIED') {
        throw new Error(`CHILD_MUTATION_ROLLED_BACK:${plan.planId}`);
      }
      aggregateConfirmed.push(...plan.changes.map((change) => change.changeId));
    }

    await saveState(instanceId, 'active-ruleset', 'active-ruleset', draft);
    await saveState(instanceId, 'draft-ruleset', 'draft-ruleset', draft);
    const projection = aggregateProjection(
      parentPlanId,
      'APPLY_COMPLETED',
      statusScope,
      totalChanges,
      aggregateConfirmed,
      childPlanIds,
      childScopes,
      aggregateSnapshotId,
    );
    await saveState(instanceId, `mutation-${parentPlanId}`, 'mutation', projection);
    return {
      planId: parentPlanId,
      status: 'APPLIED' as const,
      appliedCount: aggregateConfirmed.length,
      skippedCount: 0,
      failedCount: 0,
      verify: { verified: true, checkedAt: nowIso(), mismatches: [] },
      rollback: null,
      auditEntryId: `aggregate-${parentPlanId}`,
    };
  } catch (error) {
    const notes: string[] = [];
    for (const { snapshot } of [...preSnapshots].reverse()) {
      try {
        const rollback = await gateway.rollbackTo(snapshot);
        notes.push(...rollback.notes);
      } catch (rollbackError) {
        notes.push(`Aggregate rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    for (const staff of [...changedAssignments].reverse()) {
      if (!staff.previousWorkingHoursScheduleId) continue;
      try {
        await assignSchedule(staff, staff.previousWorkingHoursScheduleId);
      } catch (assignmentError) {
        notes.push(`Could not restore working-hours schedule for ${staff.staffMemberId}: ${assignmentError instanceof Error ? assignmentError.message : String(assignmentError)}`);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    await saveState(
      instanceId,
      `mutation-${parentPlanId}`,
      'mutation',
      aggregateProjection(parentPlanId, 'ROLLED_BACK', statusScope, totalChanges, aggregateConfirmed, childPlanIds, childScopes, aggregateSnapshotId, [message, ...notes].join('; ')),
    );
    return {
      planId: parentPlanId,
      status: 'ROLLED_BACK' as const,
      appliedCount: aggregateConfirmed.length,
      skippedCount: 0,
      failedCount: Math.max(totalChanges - aggregateConfirmed.length, 1),
      verify: null,
      rollback: { complete: notes.length === 0, notes },
      auditEntryId: `aggregate-${parentPlanId}`,
    };
  }
}

export async function recoverScheduleScope(instanceId: string, scope: ScheduleScope) {
  if (scope.scheduleId === 'rules-only') return null;
  const orchestrator = new ScheduleMutationOrchestrator({
    gateway: new WixCalendarScheduleGateway(),
    journal: new WixDataMutationJournal(instanceId),
    clock: { now: () => nowIso(), zone: () => 'UTC' },
    siteId: instanceId,
    actor: 'advanced-booking-rules-runtime',
  });
  return orchestrator.recoverInterruptedApply(scope);
}
