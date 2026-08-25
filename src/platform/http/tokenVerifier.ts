/**
 * TokenVerifier port — the adapter seam for caller-token verification on every
 * HTTP endpoint (INT-C2-1 item b; Technical Contract §6).
 *
 * BINDING PLATFORM FACT (Contract §6): Wix HTTP endpoints have NO built-in
 * permissions model — "reachable by anyone who knows its URL". Every endpoint
 * MUST therefore verify the caller token explicitly. The production adapter
 * wraps `auth.getTokenInfo()` from `@wix/essentials`; dashboard frontends call
 * these endpoints via `httpClient.fetchWithAuth()`, which attaches the caller
 * token. This module stays 100% Wix-import-free: the real adapter lives with
 * the scaffolded thin `src/pages/api/*` files (see ./README.md wiring protocol).
 *
 * FAIL-CLOSED CONTRACT: `verify` returns null whenever the presented token
 * cannot be trusted RIGHT NOW for ANY reason — token absent from the request,
 * malformed, signature-invalid, wrong audience, or EXPIRED. Handlers translate
 * null into a typed fail-closed rejection before touching any store. Verifiers
 * throw only for their own infrastructure bugs; handlers also treat a thrown
 * verifier error as a rejection (never as an authorization).
 */

/** Minimal verified-caller identity the handlers rely on. */
export interface VerifiedCallerToken {
  /**
   * Stable caller identity (e.g. the Wix user id reported by the token info).
   * Used ONLY for audit attribution and response echo — never for rule logic.
   */
  subject: string;
}

export interface TokenVerifier {
  /**
   * Resolves the caller's presented token to a verified identity.
   * Returns null when the token is missing, invalid or expired (fail-closed).
   */
  verify(authToken: string): Promise<VerifiedCallerToken | null>;
}
