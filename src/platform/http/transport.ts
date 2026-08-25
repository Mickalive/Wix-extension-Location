/**
 * Transport-agnostic request/response contracts for the token-verified HTTP
 * endpoint handler layer (INT-C2-1 item b; Blueprint §4 flow 2; Contract §6).
 *
 * These handlers are PURE modules: they never import `@wix/*`, never touch
 * `Request`/`Response`, and own no HTTP mechanics. The thin `src/pages/api/*`
 * adapters (deferred to the authenticated scaffold — see ./README.md) perform
 * all platform wiring: token extraction, JSON parsing, serialization, and the
 * error mapping below.
 *
 * Response DTOs are composed exclusively from canonical `src/shared/types`
 * primitives (RuleSetDTO, MutationRecordState, Instant, ScheduleScope, ...);
 * failures carry typed codes from the shared error taxonomy
 * (`src/shared/errors.ts`). No business-rule logic exists in this layer:
 * endpoints validate SHAPE + REVISION only.
 */
import { isPlatformError } from '../../shared/errors';
import type { ErrorCode, PlatformError } from '../../shared/errors';

/** Everything a pure handler needs to know about one HTTP request. */
export interface EndpointRequest {
  /**
   * Caller credential as extracted by the thin adapter (Contract §6: every
   * endpoint must verify the caller token). Absent/empty ⇒ fail-closed.
   */
  authToken?: string | null;
  /** Parsed JSON body (undefined for bodiless requests); handlers validate shape. */
  body?: unknown;
  /** Parsed query parameters (e.g. `?planId=...`). */
  query?: Readonly<Record<string, string>>;
}

export interface HttpResponse<T> {
  status: number;
  body: T;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retriable: boolean;
    details?: Record<string, unknown>;
  };
}

/**
 * HTTP status mapping for the shared error taxonomy. Authentication
 * rejections carry the dedicated 'UNAUTHORIZED' code (additive Director
 * amendment executed at integration of run 32787032785, exactly as staged in
 * ./README.md §4) and map to 401 through this table — no class check needed.
 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  INVALID_QUERY: 400,
  UNAUTHORIZED: 401,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_REPLAY_CONFLICT: 409,
  SNAPSHOT_REQUIRED: 409,
  INVALID_STATE: 409,
  VERIFY_FAILED: 500,
  ROLLBACK_INCOMPLETE: 500,
  INTERNAL_ERROR: 500,
  GATEWAY_UNAVAILABLE: 503,
  ENTITLEMENT_DEGRADED: 503,
};

function statusForPlatformError(error: PlatformError): number {
  const mapped = STATUS_BY_CODE[error.code];
  return mapped ?? 500;
}

/**
 * Single error-exit for thin adapters: maps ANY thrown value to a typed
 * response body. PlatformErrors keep their shared-taxonomy code; everything
 * else collapses to INTERNAL_ERROR (never leak internals, never fail open).
 */
export function httpResponseForError(error: unknown): HttpResponse<ErrorBody> {
  if (isPlatformError(error)) {
    return {
      status: statusForPlatformError(error),
      body: {
        error: {
          code: error.code,
          message: error.message,
          retriable: error.retriable,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'unexpected handler failure',
        retriable: false,
      },
    },
  };
}
