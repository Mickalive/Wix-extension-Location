/**
 * Upgrade entry point (Contract §7, binding):
 *
 *   https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>
 *
 * opened in a new tab. Wix makes the developer-side restriction mandatory
 * ("it's your responsibility as the developer to code behavior that limits
 * features for certain plans") and review-tests it — the dashboard must point
 * merchants here when `PolicyDecision.overLimit` is true.
 *
 * Purity: string construction only; no Wix imports.
 */

const UPGRADE_URL_BASE = 'https://www.wix.com/apps/upgrade/';

/**
 * Build the contracted upgrade URL. Identifiers are validated (non-empty,
 * whitespace-free) and interpolated verbatim: Wix app/instance identifiers
 * are opaque GUID-shaped tokens, so encoding would only risk deviating from
 * the byte-exact contracted shape.
 */
export function buildUpgradeUrl(appId: string, instanceId: string): string {
  assertIdentifier(appId, 'appId');
  assertIdentifier(instanceId, 'instanceId');
  return `${UPGRADE_URL_BASE}${appId}?appInstanceId=${instanceId}`;
}

function assertIdentifier(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || /\s/.test(value)) {
    throw new TypeError(
      `buildUpgradeUrl: ${name} must be a non-empty identifier without whitespace`,
    );
  }
}
