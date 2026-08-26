/**
 * Bookings Validation service-plugin registration shape — INT-C6-R1.
 *
 * Wires the DOCUMENTED extension-registration shape of the enforcement hook
 * (Technical Contract §3 SERVICE_PLUGIN row; §5.3 payload contract;
 * reports/recon/PLATFORM.md §10, source S8 — plugin introduction page,
 * fetched 2026-08-24):
 *
 * - Config JSON: `deploymentUri` (our backend endpoint implementing the
 *   handlers) + `validationTargets` (CREATE / CANCEL / RESCHEDULE and the
 *   multi-service variants we support).
 * - Handler side: `bookingsValidation.provideHandlers()` from the Bookings
 *   service-plugins SDK module, delegating to `createValidationHandlers` per
 *   src/platform/validation-plugin/README.md §6 (thin-adapter protocol).
 * - Registration channel: the unified-CLI generate menu has NOT yet been
 *   observed for this plugin (empirically unconfirmed until gate T-VP0), so
 *   the documented fallback governs: create the extension in the app
 *   dashboard (Extensions → Create Extension → Bookings) with this config.
 * - Service-plugin changes take effect only after `wix release` (Contract §6).
 *
 * The target list is DERIVED from src/platform/validation-plugin/targets.ts —
 * the single source of truth — so the registered surface can never drift from
 * the implemented handler matrix (test-enforced).
 *
 * Purity: no Wix SDK imports here. The SDK import path is documented in this
 * comment and in ./README.md on purpose: code strings must stay free of
 * module-specifier shapes so the purity gate keeps scanning this directory.
 */

import { PlatformError } from '../../shared/errors';
import { VALIDATION_TARGETS } from '../validation-plugin/targets';
import type { ValidationTarget } from '../validation-plugin/targets';

/** Platform extension kind (unified-CLI/catalog vocabulary). */
export const BOOKINGS_VALIDATION_EXTENSION_KIND = 'SERVICE_PLUGIN';

/** Catalog name of the plugin (recon §4.2/§10). */
export const BOOKINGS_VALIDATION_CATALOG_NAME = 'Bookings validation service plugin';

/**
 * Default deployment URI for our handler endpoint. Derivation: HTTP endpoints
 * are file-based `src/pages/api/<name>.ts` served at `/api/<name>` (recon §3/
 * §4.2, source S9) — a project-internal route, not an account identifier.
 * The thin adapter file itself is created at scaffold time per the
 * validation-plugin README §6 protocol.
 */
export const DEFAULT_VALIDATION_DEPLOYMENT_URI = '/api/bookings-validation';

/** The documented registration config of the Bookings Validation plugin. */
export interface BookingsValidationExtensionConfig {
  /** Backend endpoint Wix calls before create/cancel/reschedule persists. */
  readonly deploymentUri: string;
  /** Operations we validate — exactly the six implemented handler targets. */
  readonly validationTargets: readonly ValidationTarget[];
}

/**
 * Validates a deployment URI. Accepts ONLY:
 * - an `/api/`-rooted endpoint path (our documented HTTP-endpoint prefix), or
 * - an `https://` URL with a host.
 * Rejects empty/whitespace-bearing values, non-https remote URLs, query or
 * fragment parts, and path-traversal segments. Returns the problem string or
 * null when acceptable.
 */
export function validateDeploymentUri(uri: string): string | null {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    return 'deploymentUri must be a non-empty string';
  }
  if (/\s/.test(uri)) {
    return 'deploymentUri must not contain whitespace';
  }
  if (uri.includes('?') || uri.includes('#')) {
    return 'deploymentUri must be a bare endpoint path or URL (no query or fragment)';
  }
  if (uri.startsWith('/')) {
    if (!uri.startsWith('/api/')) {
      return 'relative deploymentUri must live under the documented HTTP-endpoint prefix /api/ (pages/api/<name>.ts serves at /api/<name>)';
    }
    if (uri.includes('..')) {
      return 'deploymentUri must not contain path-traversal segments';
    }
    return null;
  }
  if (uri.startsWith('https://')) {
    const rest = uri.slice('https://'.length);
    if (rest.length === 0 || rest.startsWith('/')) {
      return 'https deploymentUri must include a host';
    }
    if (uri.includes('..')) {
      return 'deploymentUri must not contain path-traversal segments';
    }
    return null;
  }
  return 'deploymentUri must be either an /api/-rooted endpoint path or an https:// URL';
}

/**
 * Builds the frozen, JSON-ready registration config. The target list is a
 * frozen copy of VALIDATION_TARGETS (single source of truth); the deployment
 * URI defaults to {@link DEFAULT_VALIDATION_DEPLOYMENT_URI}.
 *
 * @throws PlatformError('INVALID_STATE') for an invalid deploymentUri — never
 * silently coerces a malformed endpoint into a registration artifact.
 */
export function buildBookingsValidationExtensionConfig(
  options?: { readonly deploymentUri?: string },
): BookingsValidationExtensionConfig {
  const deploymentUri = options?.deploymentUri ?? DEFAULT_VALIDATION_DEPLOYMENT_URI;
  const problem = validateDeploymentUri(deploymentUri);
  if (problem !== null) {
    throw new PlatformError('INVALID_STATE', problem);
  }
  return Object.freeze({
    deploymentUri,
    validationTargets: Object.freeze([...VALIDATION_TARGETS]),
  });
}
