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
 *   BAD_RESPONSE          - 2xx body that is not valid JSON (never leak a raw
 *                           SyntaxError to callers)
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

    const status = typeof raw?.status === 'number' ? raw.status : 0;
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new BridgeError(`HTTP_${status}`, `${method} ${path} responded with status ${status}.`, {
        status,
      });
    }

    const text = typeof raw?.text === 'function' ? await raw.text() : (raw?.bodyText ?? '');
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
     * diff the user explicitly confirmed: ops plus the confirmed hash.
     */
    requestApply(ops, confirmedDiffHash) {
      return request('/apply-plan', {
        method: 'POST',
        body: { ops, confirmedDiffHash },
      });
    },
  };
}
