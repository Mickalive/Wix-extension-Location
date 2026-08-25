/**
 * DASHBOARD_PAGE registration shape — locations usage meter.
 *
 * Scaffold handoff (gate T-VP0, docs/runbooks/T_VP0_SCAFFOLD.md): the unified
 * CLI generates the real extension entry for `DASHBOARD_PAGE`; this module is
 * the credential-free registration shape the generated file will re-export.
 * The page consumes only typed lane interfaces (bridge, upgrade URL builder)
 * and never touches Wix runtime modules directly.
 */

export const extensionType = 'DASHBOARD_PAGE';
export const extensionId = 'locations-usage';

export { renderLocationsUsagePage as mount } from '../../ui/pages/locationsUsagePage.js';
