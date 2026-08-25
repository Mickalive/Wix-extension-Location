/**
 * Token-verified RuleSet configuration endpoints (INT-C2-1 item b; Blueprint
 * §4 flow 2: dashboard → services bridge → HTTP endpoint with token
 * verification → domain-side validation of the proposed RuleSet →
 * revision-checked save; never auto-applies to schedules).
 *
 * SCOPE DISCIPLINE: these handlers validate SHAPE + REVISION only. Temporal
 * and policy semantics of a RuleSet belong to the pure rules core, which plugs
 * in through the {@link RuleSetValidationSeam} once the Rules lane reaches
 * ACCEPT (Blueprint cross-lane sequencing). No availability/pricing logic may
 * ever appear here.
 */
import { PlatformError } from '../../shared/errors';
import type { RuleSetDTO } from '../../shared/types';
import { requireVerifiedCaller } from './auth';
import type { VerifiedCallerToken } from './tokenVerifier';
import type { TokenVerifier } from './tokenVerifier';
import type { EndpointRequest, HttpResponse } from './transport';
import type { RulesConfigStore } from '../../domain/ports';

// --------------------------------------------------------------- validation

export interface RuleSetValidationIssue {
  field: string;
  message: string;
}

/**
 * Domain-side validation SEAM. The platform calls it before any store write;
 * the canonical domain validators plug in here when the Rules lane lands.
 * Returning issues rejects the PUT fail-closed with zero store mutation.
 */
export interface RuleSetValidationSeam {
  validate(next: RuleSetDTO): readonly RuleSetValidationIssue[];
}

const WEEKDAYS: ReadonlySet<string> = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const EXCEPTION_KINDS: ReadonlySet<string> = new Set(['CLOSED', 'OVERRIDE']);
const LIMIT_DIMENSIONS: ReadonlySet<string> = new Set(['DAY', 'SERVICE', 'LOCATION']);
const BOOKING_STATUSES: ReadonlySet<string> = new Set([
  'CREATED',
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'WAITING_LIST',
  'UPDATED',
  'CANCELED',
]);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Calendar-validity check for YYYY-MM-DD strings (rejects e.g. 2026-02-30). */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map((p) => Number.parseInt(p, 10));
  if (y === undefined || m === undefined || d === undefined) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

function validateWindowShape(value: unknown, field: string, issues: RuleSetValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: 'window must be an object' });
    return;
  }
  if (typeof value.weekday !== 'string' || !WEEKDAYS.has(value.weekday)) {
    issues.push({ field: `${field}.weekday`, message: 'weekday must be MON..SUN' });
  }
  for (const key of ['start', 'end'] as const) {
    const v = value[key];
    if (typeof v !== 'string' || !TIME_PATTERN.test(v)) {
      issues.push({ field: `${field}.${key}`, message: 'time must be HH:MM (00:00–23:59)' });
    }
  }
}

function validateWindowMap(
  value: unknown,
  field: string,
  issues: RuleSetValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ field, message: 'must be an object keyed by target id' });
    return;
  }
  for (const [key, windows] of Object.entries(value)) {
    if (!Array.isArray(windows)) {
      issues.push({ field: `${field}.${key}`, message: 'windows must be an array' });
      continue;
    }
    windows.forEach((w, i) => validateWindowShape(w, `${field}.${key}[${i}]`, issues));
  }
}

/**
 * STRUCTURAL shape validation only — types, enums and calendar/date formats.
 * Deliberately NO temporal or business semantics (no start<end policy, no
 * overlap math): those belong to the domain validators behind the seam.
 */
export function validateRuleSetStructure(value: unknown): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: 'ruleSet', message: 'rule set must be an object' }];
  }
  if (typeof value.ruleSetId !== 'string' || value.ruleSetId === '') {
    issues.push({ field: 'ruleSetId', message: 'non-empty string required' });
  }
  if (typeof value.revision !== 'string' || value.revision === '') {
    issues.push({ field: 'revision', message: 'non-empty string required' });
  }
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) {
    issues.push({ field: 'version', message: 'positive integer required' });
  }
  validateWindowMap(value.locationWindows, 'locationWindows', issues);
  validateWindowMap(value.serviceWindows, 'serviceWindows', issues);

  if (!Array.isArray(value.exceptions)) {
    issues.push({ field: 'exceptions', message: 'array required' });
  } else {
    value.exceptions.forEach((e, i) => {
      const field = `exceptions[${i}]`;
      if (!isRecord(e)) {
        issues.push({ field, message: 'exception must be an object' });
        return;
      }
      if (typeof e.exceptionId !== 'string' || e.exceptionId === '') {
        issues.push({ field: `${field}.exceptionId`, message: 'non-empty string required' });
      }
      if (typeof e.date !== 'string' || !isCalendarDate(e.date)) {
        issues.push({ field: `${field}.date`, message: 'calendar date YYYY-MM-DD required' });
      }
      if (typeof e.kind !== 'string' || !EXCEPTION_KINDS.has(e.kind)) {
        issues.push({ field: `${field}.kind`, message: 'kind must be CLOSED or OVERRIDE' });
      }
      if (e.windows !== undefined) {
        if (!Array.isArray(e.windows)) {
          issues.push({ field: `${field}.windows`, message: 'windows must be an array' });
        } else {
          e.windows.forEach((w, j) => validateWindowShape(w, `${field}.windows[${j}]`, issues));
        }
      }
    });
  }

  if (!Array.isArray(value.limits)) {
    issues.push({ field: 'limits', message: 'array required' });
  } else {
    value.limits.forEach((l, i) => {
      const field = `limits[${i}]`;
      if (!isRecord(l)) {
        issues.push({ field, message: 'limit must be an object' });
        return;
      }
      if (typeof l.limitId !== 'string' || l.limitId === '') {
        issues.push({ field: `${field}.limitId`, message: 'non-empty string required' });
      }
      if (typeof l.dimension !== 'string' || !LIMIT_DIMENSIONS.has(l.dimension)) {
        issues.push({ field: `${field}.dimension`, message: 'dimension must be DAY, SERVICE or LOCATION' });
      }
      if (
        typeof l.maxCount !== 'number' ||
        !Number.isSafeInteger(l.maxCount) ||
        l.maxCount < 0
      ) {
        issues.push({ field: `${field}.maxCount`, message: 'non-negative integer required' });
      }
      const statuses = l.includedStatuses;
      if (
        !Array.isArray(statuses) ||
        statuses.some((s) => typeof s !== 'string' || !BOOKING_STATUSES.has(s))
      ) {
        issues.push({
          field: `${field}.includedStatuses`,
          message: 'array of booking statuses required',
        });
      }
      if ((l.dimension === 'SERVICE' || l.dimension === 'LOCATION') && typeof l.targetId !== 'string') {
        issues.push({ field: `${field}.targetId`, message: 'target id required for SERVICE/LOCATION limits' });
      }
    });
  }
  return issues;
}

// ------------------------------------------------------------------ endpoints

export interface GetActiveRuleSetEndpointDeps {
  tokenVerifier: TokenVerifier;
  configStore: Pick<RulesConfigStore, 'loadActiveRuleSet'>;
}

/**
 * GET active RuleSet. 200 always on success; `ruleSet` is null while no rule
 * set has ever been saved (a typed, explicit "empty" rather than an error).
 */
export async function getActiveRuleSet(
  deps: GetActiveRuleSetEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<{ ruleSet: RuleSetDTO | null }>> {
  await requireVerifiedCaller(deps, request);
  const ruleSet = await deps.configStore.loadActiveRuleSet();
  return { status: 200, body: { ruleSet } };
}

export interface PutRuleSetEndpointDeps {
  tokenVerifier: TokenVerifier;
  configStore: Pick<RulesConfigStore, 'saveRuleSet'>;
  /**
   * Optional domain-side validation seam. When provided, any reported issue
   * rejects the request BEFORE the revision-checked save (zero partial writes).
   */
  domainValidation?: RuleSetValidationSeam;
}

export interface PutRuleSetRequestBody {
  ruleSet: RuleSetDTO;
  /** Optimistic-concurrency expectation; mismatch ⇒ REVISION_CONFLICT (409). */
  expectedRevision: string;
}

/**
 * PUT RuleSet: token verification → strict body shape → structural validation
 * → optional domain seam → revision-checked saveRuleSet. The save is atomic at
 * the store boundary: a REVISION_CONFLICT surfaces without partial writes.
 */
export async function putRuleSet(
  deps: PutRuleSetEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<{ ruleSet: RuleSetDTO; savedBy: VerifiedCallerToken['subject'] }>> {
  const caller = await requireVerifiedCaller(deps, request);

  const body = request.body as Partial<PutRuleSetRequestBody> | undefined;
  if (!isRecord(request.body) || !isRecord(body?.ruleSet)) {
    throw new PlatformError('INVALID_QUERY', 'body must be { ruleSet, expectedRevision }');
  }
  if (typeof body?.expectedRevision !== 'string' || body.expectedRevision === '') {
    throw new PlatformError('INVALID_QUERY', 'expectedRevision (non-empty string) is required');
  }

  const structuralIssues = validateRuleSetStructure(body.ruleSet);
  if (structuralIssues.length > 0) {
    throw new PlatformError('INVALID_QUERY', 'rule set failed structural validation', {
      details: { issues: structuralIssues },
    });
  }

  if (deps.domainValidation) {
    const domainIssues = deps.domainValidation.validate(body.ruleSet as RuleSetDTO);
    if (domainIssues.length > 0) {
      throw new PlatformError('INVALID_QUERY', 'rule set rejected by domain validation seam', {
        details: { issues: domainIssues },
      });
    }
  }

  // Revision-checked save (Blueprint §4 flow 2). Store implementations are
  // atomic: conflict ⇒ typed error, stored state untouched.
  const saved = await deps.configStore.saveRuleSet(body.ruleSet as RuleSetDTO, body.expectedRevision);
  return { status: 200, body: { ruleSet: saved, savedBy: caller.subject } };
}
