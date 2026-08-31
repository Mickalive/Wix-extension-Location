/**
 * Typed bridge to the platform HTTP services layer.
 *
 * This is the ONLY module in the dashboard lane permitted to reference Wix
 * runtime modules (enforced by tests/ui/noWixImports.test.js). The reference
 * is a guarded lazy dynamic import of the Wix essentials HTTP client, so the
 * lane stays fully testable offline: without the host runtime the bridge
 * fails safely with a typed BRIDGE_NOT_CONFIGURED error instead of crashing.
 *
 * Error model (typed BridgeError codes):
 *   BRIDGE_NOT_CONFIGURED - no transport available (offline / pre-scaffold)
 *   TRANSPORT_FAILURE     - network-level failure of the injected transport
 *   HTTP_<status>         - non-2xx response (404 maps to `null`, not an error)
 *   BAD_RESPONSE          - 2xx body that is not valid JSON, or a 2xx body
 *                           missing the endpoint's mandatory DTO envelope
 *                           (never leak a raw SyntaxError to callers)
 *
 * Mutation-lifecycle endpoints (DASH-C3-1; Blueprint §4 flow 3). The DTOs
 * mirror the accepted platform handlers in
 * `src/platform/http/mutationEndpoints.ts` verbatim:
 *   getMutationStatus(planId) -> GET  <base>/mutation-status?planId=…
 *       success body `{ status: MutationStatusProjection }`; the projection is
 *       returned unwrapped. 404 (platform NOT_FOUND: no journal record yet)
 *       maps to `null`. An empty or envelope-less 2xx body is a protocol
 *       violation and surfaces as BAD_RESPONSE — unlike GET /ruleset, "no
 *       body" must never be mistaken for "no record" while polling.
 *   recover(scope)            -> POST <base>/recover  body `{ scope }`
 *       success body `{ recovery: RecoverySummary | null }`; the summary is
 *       returned unwrapped, including a legit `null` ("nothing pending for
 *       this scope"). Same strict envelope rule as above.
 *
 * Entitlement meter endpoint (DASH-C4-1a; Blueprint §4 flow 5):
 *   getEntitlementMeter()     -> GET <base>/meter
 *       success body is the PINNED cross-lane DTO (identically pinned in
 *       INT-C4-1c and docs/NEXT_CYCLE.json cross_lane_compatibility):
 *         { meter:    { count: number|null, degraded: boolean },
 *           coverage: { allowedLocationIds: string[], overLimit: boolean,
 *                       degraded: boolean, warning: string|null } }
 *       returned verbatim after strict shape validation. 404 (documented n/a:
 *       no usage information) maps to `null`. An empty 2xx body, malformed
 *       JSON, or any body not matching the pinned shape is a protocol
 *       violation and surfaces as BAD_RESPONSE — the dashboard must never
 *       render an entitlement state invented from a drifted payload.
 *
 * Path prefix note: paths here are relative to `baseUrl` exactly like the
 * existing `/ruleset` and `/apply-plan` methods; final URL reconciliation is
 * a scaffold-time concern documented in src/platform/http/README.md.
 */

export class BridgeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{status?: number, cause?: unknown}} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.status = options.status ?? null;
    this.cause = options.cause;
  }
}

export function isBridgeError(value) {
  return value instanceof BridgeError;
}

const DEFAULT_TIMEOUT_MS = 15000;

function defaultTransportLoader() {
  // Guarded dynamic import: resolves only inside the Wix dashboard runtime.
  // Kept as the literal specifier on purpose — the purity scanner for this
  // lane must see exactly one offender file (this one).
  return import('@wix/essentials').then((mod) => {
    const client = mod?.httpClient;
    if (!client || typeof client.fetchWithAuth !== 'function') {
      throw new BridgeError(
        'BRIDGE_NOT_CONFIGURED',
        'Wix authenticated HTTP client is unavailable in this runtime.',
      );
    }
    return client.fetchWithAuth;
  });
}

/**
 * @param {{transportLoader?: () => Promise<(path: string, init?: object) => Promise<ResponseLike>>, baseUrl?: string, timeoutMs?: number}} [options]
 */
export function createServicesBridge(options = {}) {
  const transportLoader = options.transportLoader ?? defaultTransportLoader;
  const baseUrl = options.baseUrl ?? '/api/rules';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cachedTransport;

  async function getTransport() {
    if (!cachedTransport) {
      try {
        cachedTransport = await transportLoader();
      } catch (error) {
        if (isBridgeError(error)) throw error;
        throw new BridgeError(
          'BRIDGE_NOT_CONFIGURED',
          'Dashboard services are not connected yet (no Wix runtime transport).',
          { cause: error },
        );
      }
    }
    return cachedTransport;
  }

  /** Status of a transport response; missing/non-numeric status means 0 (non-2xx path). */
  function extractStatus(raw) {
    return typeof raw?.status === 'number' ? raw.status : 0;
  }

  async function readBodyText(raw) {
    return typeof raw?.text === 'function' ? await raw.text() : (raw?.bodyText ?? '');
  }

  /**
   * Core request. Returns parsed JSON for 2xx responses, `null` for 404,
   * throws typed BridgeError otherwise.
   *
   * @returns {Promise<unknown>}
   */
  async function request(path, { method = 'GET', body } = {}) {
    // Resolution failures are already typed BridgeErrors.
    const transport = await getTransport();
    let raw;
    try {
      raw = await transport(`${baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs,
      });
    } catch (error) {
      throw new BridgeError('TRANSPORT_FAILURE', `Request to ${method} ${path} failed before a response arrived.`, {
        cause: error,
      });
    }

    const status = extractStatus(raw);
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new BridgeError(`HTTP_${status}`, `${method} ${path} responded with status ${status}.`, {
        status,
      });
    }

    const text = await readBodyText(raw);
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new BridgeError(
        'BAD_RESPONSE',
        `${method} ${path} returned a 2xx body that is not valid JSON.`,
        { status, cause: error },
      );
    }
  }

  /**
   * Strict envelope request for the mutation-lifecycle endpoints. Identical
   * error taxonomy to `request`, but a 2xx response MUST carry a non-empty
   * JSON object body with the expected envelope key — an empty or shapeless
   * success body is a protocol violation (BAD_RESPONSE), never silently
   * interpreted as "absent". The envelope value is returned unwrapped and may
   * legitimately be `null` when the endpoint documents that (recover).
   */
  async function requestEnvelope(path, { method, body, envelopeKey }) {
    const transport = await getTransport();
    let raw;
    try {
      raw = await transport(`${baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs,
      });
    } catch (error) {
      throw new BridgeError('TRANSPORT_FAILURE', `Request to ${method} ${path} failed before a response arrived.`, {
        cause: error,
      });
    }

    const status = extractStatus(raw);
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new BridgeError(`HTTP_${status}`, `${method} ${path} responded with status ${status}.`, {
        status,
      });
    }

    const text = await readBodyText(raw);
    if (text.trim() === '') {
      throw new BridgeError(
        'BAD_RESPONSE',
        `${method} ${path} returned an empty 2xx body where a "${envelopeKey}" envelope was required.`,
        { status },
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new BridgeError(
        'BAD_RESPONSE',
        `${method} ${path} returned a 2xx body that is not valid JSON.`,
        { status, cause: error },
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !(envelopeKey in parsed)) {
      throw new BridgeError(
        'BAD_RESPONSE',
        `${method} ${path} returned a 2xx body without the expected "${envelopeKey}" envelope.`,
        { status },
      );
    }
    return parsed[envelopeKey];
  }

  /**
   * Strict pinned-DTO request for the entitlement meter. Identical error
   * taxonomy to `request`/`requestEnvelope`, but the 2xx body MUST match the
   * pinned `{meter, coverage}` shape exactly (see module header): an empty,
   * malformed, or drifted success body is BAD_RESPONSE, never silently
   * interpreted as data. Only a 404 status maps to `null` (documented n/a).
   */
  async function requestPinnedMeterDto(path) {
    const transport = await getTransport();
    let raw;
    try {
      raw = await transport(`${baseUrl}${path}`, {
        method: 'GET',
        headers: {},
        body: undefined,
        timeoutMs,
      });
    } catch (error) {
      throw new BridgeError('TRANSPORT_FAILURE', `Request to GET ${path} failed before a response arrived.`, {
        cause: error,
      });
    }

    const status = extractStatus(raw);
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new BridgeError(`HTTP_${status}`, `GET ${path} responded with status ${status}.`, {
        status,
      });
    }

    const text = await readBodyText(raw);
    if (text.trim() === '') {
      throw new BridgeError(
        'BAD_RESPONSE',
        `GET ${path} returned an empty 2xx body where the entitlement meter DTO was required.`,
        { status },
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new BridgeError(
        'BAD_RESPONSE',
        `GET ${path} returned a 2xx body that is not valid JSON.`,
        { status, cause: error },
      );
    }
    if (!isEntitlementMeterDto(parsed)) {
      throw new BridgeError(
        'BAD_RESPONSE',
        `GET ${path} returned a 2xx body that does not match the pinned entitlement meter DTO.`,
        { status },
      );
    }
    return parsed;
  }

  return {
    request,
    /** Active rule set or null when none exists (404 semantics). */
    getActiveRuleSet() {
      return request('/ruleset', { method: 'GET' });
    },
    /** Persists a validated draft; returns the saved rule set. */
    saveRuleSet(ruleSet) {
      return request('/ruleset', { method: 'PUT', body: ruleSet });
    },
    /**
     * Requests schedule application. The backend orchestrator only accepts a
     * diff the user explicitly confirmed: the confirmed-diff hash reference.
     * The POST /apply-plan body must be exactly { confirmedDiffHash } — no
     * ops or inline plan data (platform mutationEndpoints.ts postApplyPlan).
     */
    requestApply(confirmedDiffHash) {
      return request('/apply-plan', {
        method: 'POST',
        body: { confirmedDiffHash },
      });
    },
    /**
     * Mutation journal projection for one plan (Blueprint §4 flow 3). Returns
     * the `{planId, state, scope, confirmedChangeIds, totalChanges, updatedAt,
     * snapshotId}` projection unwrapped, or null when no journal record exists
     * (platform NOT_FOUND -> 404 semantics).
     */
    getMutationStatus(planId) {
      const path = `/mutation-status?planId=${encodeURIComponent(String(planId))}`;
      return requestEnvelope(path, { method: 'GET', envelopeKey: 'status' });
    },
    /**
     * User-initiated crash-mid-apply recovery for one schedule scope (gate
     * T-RB1 counterpart). The dashboard calls this ONLY from an explicit user
     * click (Contract §9.2); this method performs no policy of its own.
     * Returns the RecoverySummary unwrapped, or null when nothing is pending
     * for the scope (documented platform response `{ recovery: null }`).
     */
    recover(scope) {
      return requestEnvelope('/recover', { method: 'POST', body: { scope }, envelopeKey: 'recovery' });
    },
    /**
     * Billable-location meter + entitlement coverage (DASH-C4-1a; Blueprint
     * §4 flow 5). Returns the pinned `{meter, coverage}` DTO verbatim, or
     * null when the endpoint reports no usage information (404 semantics).
     */
    getEntitlementMeter() {
      return requestPinnedMeterDto('/meter');
    },
  };
}

/**
 * Strict shape check for the pinned entitlement meter DTO. Required fields
 * must carry exactly the pinned types; unknown extra fields are tolerated so
 * a purely additive backend extension cannot break the dashboard.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isEntitlementMeterDto(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { meter, coverage } = value;
  if (typeof meter !== 'object' || meter === null || Array.isArray(meter)) return false;
  if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) return false;
  if (!(meter.count === null || typeof meter.count === 'number')) return false;
  if (typeof meter.degraded !== 'boolean') return false;
  if (!Array.isArray(coverage.allowedLocationIds)) return false;
  if (!coverage.allowedLocationIds.every((id) => typeof id === 'string')) return false;
  if (typeof coverage.overLimit !== 'boolean') return false;
  if (typeof coverage.degraded !== 'boolean') return false;
  if (!(coverage.warning === null || typeof coverage.warning === 'string')) return false;
  return true;
}
