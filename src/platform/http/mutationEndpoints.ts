/**
 * Token-verified schedule-mutation endpoints (INT-C2-1 item b; Blueprint §4
 * flows 2–3 and Contract §9).
 *
 * - POST apply-plan accepts ONLY a confirmed-diff hash reference (§9.2
 *   diff-and-confirm artifact). Inline plans are structurally impossible to
 *   submit: the strict body schema rejects any other key, so no caller can
 *   smuggle an unreviewed MutationPlan through this endpoint. The referenced
 *   plan is resolved through the injected {@link ConfirmedPlanLookup} port —
 *   the record written when the user explicitly confirmed the reviewed diff.
 * - GET mutation-status projects the durable journal record for dashboard
 *   progress display.
 * - POST recover drives crash-mid-apply recovery (gate T-RB1) for a scope.
 *
 * SCOPE DISCIPLINE: the orchestrator applies exactly the user-confirmed plan;
 * these endpoints add zero rule logic. All DTOs compose canonical shared types.
 */
import { PlatformError } from '../../shared/errors';
import type {
  Instant,
  MutationRecordState,
  ScheduleScope,
} from '../../shared/types';
import { requireVerifiedCaller } from './auth';
import type { VerifiedCallerToken } from './tokenVerifier';
import type { TokenVerifier } from './tokenVerifier';
import type { EndpointRequest, HttpResponse } from './transport';
import type { RecoverySummary } from '../schedule-mutation/orchestrator';
import type { MutationSummary } from '../schedule-mutation/orchestrator';
import type { MutationJournalStore } from '../../domain/ports';
import type { MutationPlan } from '../../domain/ports';

// ------------------------------------------------------- confirmed-diff seam

/**
 * A user-confirmed diff record (Contract §9.2): the exact plan the reviewer
 * approved, bound to its hash reference. The apply-plan endpoint resolves
 * ONLY from here — it never accepts plan content itself.
 */
export interface ConfirmedPlanReference {
  /** Stable hash of the confirmed diff content (the endpoint's only input). */
  diffHash: string;
  plan: MutationPlan;
  /** Who confirmed (dashboard actor), kept for audit cross-checking. */
  confirmedBy: string;
  confirmedAt: Instant;
}

export interface ConfirmedPlanLookup {
  findByDiffHash(diffHash: string): Promise<ConfirmedPlanReference | null>;
}

// ------------------------------------------------------- apply-plan endpoint

/** Narrow orchestrator surface consumed here (keeps handlers decoupled). */
export interface ApplyPlanExecutor {
  applyPlan(plan: MutationPlan): Promise<MutationSummary>;
}

export interface ApplyPlanEndpointDeps {
  tokenVerifier: TokenVerifier;
  confirmedPlanLookup: ConfirmedPlanLookup;
  orchestrator: ApplyPlanExecutor;
}

export interface ApplyPlanRequestBody {
  /**
   * The ONLY accepted input: hash reference of a previously confirmed diff.
   * Any additional key (e.g. an inline `plan`) is rejected INVALID_QUERY.
   */
  confirmedDiffHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function postApplyPlan(
  deps: ApplyPlanEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<{ summary: MutationSummary; requestedBy: VerifiedCallerToken['subject'] }>> {
  const caller = await requireVerifiedCaller(deps, request);

  if (!isRecord(request.body)) {
    throw new PlatformError(
      'INVALID_QUERY',
      'body must be exactly { confirmedDiffHash }; inline plans are not accepted (Contract §9.2)',
    );
  }
  const keys = Object.keys(request.body);
  const unexpected = keys.filter((k) => k !== 'confirmedDiffHash');
  if (unexpected.length > 0 || typeof request.body.confirmedDiffHash !== 'string') {
    throw new PlatformError(
      'INVALID_QUERY',
      'body must be exactly { confirmedDiffHash }: execution requires the confirmed-diff hash reference of a user-approved diff',
      { details: { unexpectedKeys: unexpected } },
    );
  }
  const confirmedDiffHash = request.body.confirmedDiffHash;
  if (confirmedDiffHash.trim() === '') {
    throw new PlatformError('INVALID_QUERY', 'confirmedDiffHash must be a non-empty string');
  }

  const confirmed = await deps.confirmedPlanLookup.findByDiffHash(confirmedDiffHash);
  if (!confirmed) {
    throw new PlatformError(
      'NOT_FOUND',
      `no user-confirmed diff exists for hash reference ${confirmedDiffHash}; confirm the reviewed diff first (Contract §9.2)`,
      { details: { confirmedDiffHash } },
    );
  }

  const summary = await deps.orchestrator.applyPlan(confirmed.plan);
  return { status: 200, body: { summary, requestedBy: caller.subject } };
}

// --------------------------------------------------- mutation status endpoint

export interface MutationStatusEndpointDeps {
  tokenVerifier: TokenVerifier;
  journal: Pick<MutationJournalStore, 'loadByPlanId'>;
}

/** Journal projection composed from shared types (no snapshot/plan payload). */
export interface MutationStatusProjection {
  planId: string;
  state: MutationRecordState;
  scope: ScheduleScope;
  confirmedChangeIds: string[];
  totalChanges: number;
  updatedAt: Instant;
  snapshotId: string;
}

export async function getMutationStatus(
  deps: MutationStatusEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<{ status: MutationStatusProjection }>> {
  await requireVerifiedCaller(deps, request);

  const planId = request.query?.planId;
  if (typeof planId !== 'string' || planId === '') {
    throw new PlatformError('INVALID_QUERY', 'query parameter planId is required');
  }
  const record = await deps.journal.loadByPlanId(planId);
  if (!record) {
    throw new PlatformError('NOT_FOUND', `no mutation journal record for plan ${planId}`);
  }
  return {
    status: 200,
    body: {
      status: {
        planId: record.planId,
        state: record.state,
        scope: record.scope,
        confirmedChangeIds: [...record.confirmedChangeIds],
        totalChanges: record.plan.changes.length,
        updatedAt: record.updatedAt,
        snapshotId: record.snapshot.snapshotId,
      },
    },
  };
}

// -------------------------------------------------------- recover endpoint

export interface RecoverEndpointDeps {
  tokenVerifier: TokenVerifier;
  orchestrator: {
    recoverInterruptedApply(scope: ScheduleScope): Promise<RecoverySummary | null>;
  };
}

const OWNER_TYPES: ReadonlySet<string> = new Set(['BUSINESS', 'STAFF']);

/**
 * POST recover: crash-mid-apply recovery for one schedule scope (gate T-RB1).
 * Body `{ scope }`; `recovery` is null when nothing is pending for the scope.
 */
export async function postRecover(
  deps: RecoverEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<{ recovery: RecoverySummary | null }>> {
  await requireVerifiedCaller(deps, request);

  const body = request.body as Partial<{ scope: unknown }> | undefined;
  if (!isRecord(request.body) || !isRecord(body?.scope)) {
    throw new PlatformError('INVALID_QUERY', 'body must be { scope: ScheduleScope }');
  }
  const scope = body?.scope as Record<string, unknown>;
  if (typeof scope.scheduleId !== 'string' || scope.scheduleId === '') {
    throw new PlatformError('INVALID_QUERY', 'scope.scheduleId (non-empty string) is required');
  }
  if (typeof scope.ownerType !== 'string' || !OWNER_TYPES.has(scope.ownerType)) {
    throw new PlatformError('INVALID_QUERY', 'scope.ownerType must be BUSINESS or STAFF');
  }
  if (typeof scope.ownerId !== 'string' || scope.ownerId === '') {
    throw new PlatformError('INVALID_QUERY', 'scope.ownerId (non-empty string) is required');
  }

  const recovery = await deps.orchestrator.recoverInterruptedApply({
    scheduleId: scope.scheduleId,
    ownerType: scope.ownerType as ScheduleScope['ownerType'],
    ownerId: scope.ownerId,
    ...(typeof scope.locationId === 'string' ? { locationId: scope.locationId } : {}),
  });
  return { status: 200, body: { recovery } };
}
