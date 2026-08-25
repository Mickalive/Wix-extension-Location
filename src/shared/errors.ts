/** Pure platform/domain error taxonomy. */
export type ErrorCode =
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_REPLAY_CONFLICT'
  | 'SNAPSHOT_REQUIRED'
  | 'VERIFY_FAILED'
  | 'ROLLBACK_INCOMPLETE'
  | 'GATEWAY_UNAVAILABLE'
  | 'ENTITLEMENT_DEGRADED'
  | 'INVALID_QUERY'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly retriable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { retriable?: boolean; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.retriable = options?.retriable ?? false;
    this.details = options?.details;
  }
}

export class RevisionConflictError extends PlatformError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('REVISION_CONFLICT', message, { retriable: true, details });
    this.name = 'RevisionConflictError';
  }
}

export function isPlatformError(value: unknown): value is PlatformError {
  return value instanceof PlatformError;
}

export type TargetOperation = 'CREATE' | 'CANCEL' | 'RESCHEDULE';
export type FailureSemantics = 'FAIL_CLOSED' | 'FAIL_OPEN';

export function failureSemanticsFor(operation: TargetOperation): FailureSemantics {
  switch (operation) {
    case 'CREATE':
    case 'CANCEL':
      return 'FAIL_CLOSED';
    case 'RESCHEDULE':
      return 'FAIL_OPEN';
  }
}
