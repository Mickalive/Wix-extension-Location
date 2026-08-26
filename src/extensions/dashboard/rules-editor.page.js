/**
 * DASHBOARD_PAGE registration shape — advanced booking rules editor.
 *
 * Scaffold handoff (gate T-VP0, docs/runbooks/T_VP0_SCAFFOLD.md): the unified
 * CLI generates the real extension entry for `DASHBOARD_PAGE`; this module is
 * the credential-free registration shape the generated file will re-export.
 * The page consumes only typed lane interfaces (store, bridge, diff engine,
 * validation mirror) and never touches Wix runtime modules directly. Since
 * DASH-C5-1 it also consumes the entitlement meter through the typed bridge
 * (`getEntitlementMeter()`, pinned v1 DTO) to restrict NEW rule
 * configuration for locations outside the plan's covered set (Contract §7).
 */

export const extensionType = 'DASHBOARD_PAGE';
export const extensionId = 'rules-editor';

export { renderRulesEditorPage as mount } from '../../ui/pages/rulesEditorPage.js';
