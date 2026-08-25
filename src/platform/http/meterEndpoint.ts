/**
 * Token-verified entitlement meter endpoint (INT-C4-1 item c; Blueprint §1
 * `pages/LocationsUsage/` data source + §4 flows 1/5; Contract §6/§7/§11 C5).
 *
 * PINNED RESPONSE DTO (cross-lane contract with DASH-C4-1 — do not reshape):
 *
 *   {
 *     "meter":    { "count": number | null, "degraded": boolean },
 *     "coverage": { "allowedLocationIds": string[], "overLimit": boolean,
 *                   "degraded": boolean, "warning": string | null }
 *   }
 *
 * composed from `gate.meter()` + `gate.allowedLocationIds()` of the composed
 * entitlement gate (../composition/entitlementComposition.ts).
 *
 * BINDING BEHAVIORS:
 * - Unauthenticated ⇒ typed UNAUTHORIZED rejection (401 through the shared
 *   status map) BEFORE any gate interaction — fail-closed per Contract §6.
 * - Authenticated ⇒ ALWAYS 200. Every gate failure degrades its OWN half into
 *   the contracted fail-open shape (Contract §7/C5: a billing/counting outage
 *   must never block the dashboard with a 5xx). The two halves are isolated:
 *   a failing meter never corrupts coverage and vice versa.
 * - No business logic: this handler composes accepted billing outputs only.
 *
 * Purity: no Wix imports; token verification and all Wix access arrive via
 * injected ports (thin src/pages/api adapter owns platform mechanics per
 * ./README.md).
 */

import type { EntitlementGate, PolicyDecision } from '../../domain/ports';
import type { BillableMeterReading } from '../../billing/enforcement/entitlementGate';
import { requireVerifiedCaller } from './auth';
import type { TokenVerifier } from './tokenVerifier';
import type { EndpointRequest, HttpResponse } from './transport';

/** The pinned meter half: count unknown ⇒ degraded (never blocks bookings). */
export interface EntitlementMeterDTO {
  count: number | null;
  degraded: boolean;
}

/** The pinned coverage half: stable-ordering allowance + over-limit signal. */
export interface EntitlementCoverageDTO {
  allowedLocationIds: string[];
  overLimit: boolean;
  degraded: boolean;
  warning: string | null;
}

/** THE pinned GET /meter response body (see module docstring). */
export interface EntitlementMeterResponse {
  meter: EntitlementMeterDTO;
  coverage: EntitlementCoverageDTO;
}

/**
 * Gate surface consumed here: the canonical domain port plus the billing
 * lane's dashboard meter reading (both satisfied by
 * `composeEntitlementGate`/`composeValidationEntitlement` output).
 */
export type MeterSourceGate = EntitlementGate & {
  meter(): Promise<BillableMeterReading>;
};

export interface GetMeterEndpointDeps {
  tokenVerifier: TokenVerifier;
  entitlementGate: MeterSourceGate;
}

const DEGRADED_METER: BillableMeterReading = Object.freeze({ count: null, degraded: true });

const DEGRADED_COVERAGE_WARNING =
  'Entitlement coverage is temporarily unavailable — failing open; no booking is blocked on billing errors.';

function degradedCoverage(): EntitlementCoverageDTO {
  return {
    allowedLocationIds: [],
    overLimit: false,
    degraded: true,
    warning: DEGRADED_COVERAGE_WARNING,
  };
}

/**
 * GET /api/meter (scaffold path per ./README.md): verify caller → compose the
 * pinned DTO from the gate's two readings with per-half failure isolation →
 * 200. Throws ONLY the typed auth rejection; everything after verification is
 * total (never throws, never 5xx).
 */
export async function getEntitlementMeter(
  deps: GetMeterEndpointDeps,
  request: EndpointRequest,
): Promise<HttpResponse<EntitlementMeterResponse>> {
  await requireVerifiedCaller(deps, request);

  let meter: EntitlementMeterDTO;
  try {
    const reading = await deps.entitlementGate.meter();
    meter = { count: reading.count, degraded: reading.degraded };
  } catch {
    // Fail-open posture (§7/C5): an unreadable meter degrades explicitly.
    meter = { count: DEGRADED_METER.count, degraded: DEGRADED_METER.degraded };
  }

  let coverage: EntitlementCoverageDTO;
  try {
    const decision: PolicyDecision = await deps.entitlementGate.allowedLocationIds();
    coverage = {
      allowedLocationIds: [...decision.allowedLocationIds],
      overLimit: decision.overLimit,
      degraded: decision.degraded,
      warning: decision.warning ?? null,
    };
  } catch {
    coverage = degradedCoverage();
  }

  return { status: 200, body: { meter, coverage } };
}
