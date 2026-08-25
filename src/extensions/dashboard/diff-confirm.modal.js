/**
 * DASHBOARD_MODAL registration shape — diff-and-confirm dialog.
 *
 * Scaffold handoff (gate T-VP0, docs/runbooks/T_VP0_SCAFFOLD.md): the unified
 * CLI generates the real extension entry for `DASHBOARD_MODAL`; this module is
 * the credential-free registration shape the generated file will re-export.
 * The modal is the Contract section 9.2 informed-consent gate: it renders
 * exactly what a schedule apply would change and requires explicit
 * confirmation before any mutation request leaves the dashboard.
 */

export const extensionType = 'DASHBOARD_MODAL';
export const extensionId = 'diff-confirm';

export { openDiffPreviewModal as mount } from '../../ui/modals/diffPreviewModal.js';
