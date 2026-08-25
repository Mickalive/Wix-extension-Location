/**
 * Upgrade entry point for the dashboard lane (Contract §7, binding):
 *
 *   https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>
 *
 * opened in a NEW tab. Wix makes the developer-side restriction mandatory
 * ("it's your responsibility as the developer to code behavior that limits
 * features for certain plans") and review-tests it, so this page must point
 * merchants at exactly this URL shape when `coverage.overLimit` is true (or
 * the plan is otherwise tier-restricted).
 *
 * Mirror provenance: this file mirrors the accepted billing-lane builder
 * `src/billing/upgrade/upgradeUrl.ts` byte-for-byte in behavior. The duplicate
 * exists because this lane's credential-free suite runs on the plain Node
 * runner, which cannot import TypeScript sources; the T-VP0 React/TS port must
 * replace this module with a direct import of the billing builder (same
 * conscious-ledger pattern as the validation-mirror repoint).
 *
 * Identifiers are validated (non-empty, whitespace-free) and interpolated
 * verbatim: Wix app/instance identifiers are opaque GUID-shaped tokens, so
 * encoding would only risk deviating from the byte-exact contracted shape.
 * Account-specific identifiers are NEVER fabricated here — callers that do not
 * have them must not render an upgrade link at all.
 *
 * Purity: string construction only; no Wix imports.
 */

const UPGRADE_URL_BASE = 'https://www.wix.com/apps/upgrade/';

/**
 * Build the contracted upgrade URL.
 * @param {string} appId
 * @param {string} instanceId
 * @returns {string}
 */
export function buildUpgradeUrl(appId, instanceId) {
  assertIdentifier(appId, 'appId');
  assertIdentifier(instanceId, 'instanceId');
  return `${UPGRADE_URL_BASE}${appId}?appInstanceId=${instanceId}`;
}

function assertIdentifier(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0 || /\s/.test(value)) {
    throw new TypeError(
      `buildUpgradeUrl: ${name} must be a non-empty identifier without whitespace`,
    );
  }
}
