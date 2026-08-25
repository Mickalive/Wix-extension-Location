/**
 * Fail-closed caller verification for every HTTP endpoint handler
 * (INT-C2-1 item b; Technical Contract §6).
 *
 * "HTTP endpoints have NO built-in permissions model — reachable by anyone who
 * knows its URL." Every handler therefore begins with {@link requireVerifiedCaller}
 * and refuses to touch any store until the injected TokenVerifier accepts the
 * presented token. Missing, invalid and expired tokens all fail CLOSED with a
 * typed error BEFORE any dependency is consulted (proven by zero-store-mutation
 * tests).
 *
 * Frozen-taxonomy note: rejections use PlatformError code 'UNAUTHORIZED'
 * (additive Director amendment executed at integration of run 32787032785,
 * exactly as staged in ./README.md §4) with a structured `details.reason`,
 * carried by the dedicated UnauthorizedRequestError class so callers branch
 * on the CLASS, never by parsing messages.
 */
import { PlatformError } from '../../shared/errors';
import type { EndpointRequest } from './transport';
import type { TokenVerifier, VerifiedCallerToken } from './tokenVerifier';

export type TokenFailureReason =
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'TOKEN_VERIFIER_FAILED';

/**
 * Typed fail-closed rejection of an unauthenticated request (Contract §6).
 * `code` stays inside the frozen shared taxonomy; `reason` discriminates the
 * exact failure without string parsing.
 */
export class UnauthorizedRequestError extends PlatformError {
  readonly reason: TokenFailureReason;

  constructor(reason: TokenFailureReason, cause?: unknown) {
    super(
      'UNAUTHORIZED',
      `caller token rejected (${reason}); endpoint access is fail-closed per Technical Contract §6`,
      { retriable: false, details: { reason, authenticated: false } },
    );
    this.name = 'UnauthorizedRequestError';
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Verifies the caller BEFORE any store/gateway interaction. Throws
 * {@link UnauthorizedRequestError} on missing/invalid/expired tokens and on
 * verifier infrastructure failures — never falls through unauthenticated.
 */
export async function requireVerifiedCaller(
  deps: { tokenVerifier: TokenVerifier },
  request: EndpointRequest,
): Promise<VerifiedCallerToken> {
  const token = request.authToken;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new UnauthorizedRequestError('TOKEN_MISSING');
  }
  let verified: VerifiedCallerToken | null;
  try {
    verified = await deps.tokenVerifier.verify(token);
  } catch (cause) {
    // Verifier outage must never authorize a request (fail closed).
    throw new UnauthorizedRequestError('TOKEN_VERIFIER_FAILED', cause);
  }
  if (!verified || typeof verified.subject !== 'string' || verified.subject === '') {
    // Covers invalid AND expired tokens: the port contract maps expiry to null.
    throw new UnauthorizedRequestError('TOKEN_INVALID');
  }
  return verified;
}
