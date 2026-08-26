/**
 * Extension registration surface — INT-C6-R1.
 *
 * Declares, as data, EVERY extension this product intends to register on the
 * Wix platform, the channel each one registers through, and its status
 * (Blueprint §1 `platform/registration/`; §7 registration plan; Technical
 * Contract §3 extension table). This is the single inventory that the future
 * generated `extensions.ts` entries and dashboard-config steps must reconcile
 * against.
 *
 * STATUS HONESTY: nothing is registered anywhere yet. Every entry is
 * PLANNED_UNTIL_T_VP0 — real extension IDs, generated files and dashboard
 * configuration come into existence only at the authenticated scaffold under
 * human-owned credentials (Contract §15/§16). No identifier on this surface
 * is invented; tests sweep these modules for identifier-shaped strings.
 *
 * Purity: documentation-only data module; no I/O, no SDK imports. Package
 * specifiers are deliberately kept out of code strings (see ./README.md).
 */

/**
 * HOW an extension reaches registration:
 * - UNIFIED_CLI_GENERATE — available in the documented `wix generate --type`
 *   enum (recon §4, source S6).
 * - APP_DASHBOARD_FALLBACK — created/configured in the app dashboard, either
 *   as the documented fallback or because that is the only channel.
 * - INTERACTIVE_CLI_MENU — interactive CLI menu only (not in the --type enum).
 * - FILE_BASED_NO_REGISTRATION — not a registered extension at all.
 */
export type RegistrationChannel =
  | 'UNIFIED_CLI_GENERATE'
  | 'APP_DASHBOARD_FALLBACK'
  | 'INTERACTIVE_CLI_MENU'
  | 'FILE_BASED_NO_REGISTRATION';

/** Lifecycle of a registration-surface entry. */
export type ExtensionRegistrationStatus = 'PLANNED_UNTIL_T_VP0' | 'REGISTERED_AT_SCAFFOLD';

/** The extension kinds this product uses (Contract §3; recon §4). */
export type ExtensionKind =
  | 'DASHBOARD_PAGE'
  | 'DASHBOARD_MODAL'
  | 'EVENT'
  | 'WEBHOOK_SUBSCRIPTION'
  | 'SERVICE_PLUGIN_BOOKINGS_VALIDATION'
  | 'DATA_COLLECTIONS'
  | 'HTTP_ENDPOINTS';

/** One row of the registration inventory. */
export interface ExtensionRegistration {
  /** Stable internal slug (NOT a Wix extension ID). */
  readonly id: string;
  readonly kind: ExtensionKind;
  readonly channel: RegistrationChannel;
  readonly status: ExtensionRegistrationStatus;
  /**
   * Repo artifact implementing this surface today, when one exists.
   * Repo-relative; existence is test-enforced so the inventory cannot point
   * at ghosts.
   */
  readonly productSourcePath?: string;
  readonly notes: readonly string[];
}

function entry(registration: ExtensionRegistration): ExtensionRegistration {
  return Object.freeze({ ...registration, notes: Object.freeze([...registration.notes]) });
}

const RULES_EDITOR_PAGE = entry({
  id: 'dashboard.rules-editor.page',
  kind: 'DASHBOARD_PAGE',
  channel: 'UNIFIED_CLI_GENERATE',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/extensions/dashboard/rules-editor.page.js',
  notes: [
    'Rules editor configuration UX (location/service windows, split hours, exceptions, caps).',
    'Page implementation staged by the dashboard lane; the generated dashboard-page wrapper lands at scaffold.',
  ],
});

const LOCATIONS_USAGE_PAGE = entry({
  id: 'dashboard.locations-usage.page',
  kind: 'DASHBOARD_PAGE',
  channel: 'UNIFIED_CLI_GENERATE',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/extensions/dashboard/locations-usage.page.js',
  notes: [
    'Billable-location meter, plan allowance and upgrade entry point (Contract §7).',
    'Consumes the platform meter endpoint DTO via the dashboard services bridge only.',
  ],
});

const DIFF_CONFIRM_MODAL = entry({
  id: 'dashboard.diff-confirm.modal',
  kind: 'DASHBOARD_MODAL',
  channel: 'UNIFIED_CLI_GENERATE',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/extensions/dashboard/diff-confirm.modal.js',
  notes: [
    'Explicit-intent confirmation showing exactly what will change before any schedule mutation (Contract §9.2).',
  ],
});

const BOOKINGS_VALIDATION_PLUGIN = entry({
  id: 'backend.bookings-validation.service-plugin',
  kind: 'SERVICE_PLUGIN_BOOKINGS_VALIDATION',
  channel: 'APP_DASHBOARD_FALLBACK',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/platform/validation-plugin',
  notes: [
    'Documented config JSON: deploymentUri + validationTargets — buildBookingsValidationExtensionConfig() in ./validationExtension.ts.',
    'Channel note: presence in the unified generate menu is empirically unconfirmed until T-VP0; the documented fallback governs — app dashboard, Extensions → Create Extension → Bookings (Contract §3; plugin introduction page).',
    'Handlers delegate to createValidationHandlers per src/platform/validation-plugin/README.md §6; explicit results for every bulk index.',
    'Effective on sites only after wix release (Contract §6); enforcement claims stay gated on T-VP1–T-VP5.',
  ],
});

const DATA_COLLECTIONS = entry({
  id: 'backend.data-collections',
  kind: 'DATA_COLLECTIONS',
  channel: 'INTERACTIVE_CLI_MENU',
  status: 'PLANNED_UNTIL_T_VP0',
  notes: [
    'App-defined CMS collections for rule sets, exceptions, counters and audit/explain records (Blueprint §4 flow 1/3 persistence).',
    'Not in the wix generate --type enum; created via the interactive menu (recon V3/S20). Collection schemas are defined in-repo at scaffold.',
    'Runtime must tolerate older collection schemas on installed sites (Contract §11 C4).',
  ],
});

const BOOKING_LIFECYCLE_EVENTS = entry({
  id: 'backend.booking-lifecycle.events',
  kind: 'EVENT',
  channel: 'UNIFIED_CLI_GENERATE',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/platform/webhooks',
  notes: [
    'Booking lifecycle events maintain cached counters between authoritative reads (Blueprint §4 flow 4).',
    'Ingestion pipeline already enforces dedup by envelope id and entityEventSequence ordering.',
  ],
});

const APP_MANAGEMENT_PLAN_WEBHOOKS = entry({
  id: 'backend.app-management.plan-webhooks',
  kind: 'WEBHOOK_SUBSCRIPTION',
  channel: 'APP_DASHBOARD_FALLBACK',
  status: 'PLANNED_UNTIL_T_VP0',
  notes: [
    'Paid Plan Purchased / Paid Plan Auto Renewal Cancelled / App Installation Updated+Created subscriptions feed the billing projector (Contract §5.2/§7).',
    'Subscriptions are configured in the app dashboard; subscribing auto-adds its required scope.',
  ],
});

const HTTP_ENDPOINTS = entry({
  id: 'backend.http-endpoints',
  kind: 'HTTP_ENDPOINTS',
  channel: 'FILE_BASED_NO_REGISTRATION',
  status: 'PLANNED_UNTIL_T_VP0',
  productSourcePath: 'src/platform/http',
  notes: [
    'Dashboard↔backend transport as file-based pages/api adapters served at /api/<name> — NOT registered extensions (no extensions.ts entry, invisible in the app dashboard).',
    'Every endpoint verifies the caller token before any effect (Contract §6); thin adapters own all SDK usage behind injected ports.',
  ],
});

/** The complete planned registration inventory (frozen). */
export const EXTENSION_REGISTRATIONS: readonly ExtensionRegistration[] = Object.freeze([
  RULES_EDITOR_PAGE,
  LOCATIONS_USAGE_PAGE,
  DIFF_CONFIRM_MODAL,
  BOOKINGS_VALIDATION_PLUGIN,
  DATA_COLLECTIONS,
  BOOKING_LIFECYCLE_EVENTS,
  APP_MANAGEMENT_PLAN_WEBHOOKS,
  HTTP_ENDPOINTS,
]);

/** All registrations announced through one channel. */
export function extensionRegistrationsByChannel(
  channel: RegistrationChannel,
): readonly ExtensionRegistration[] {
  return EXTENSION_REGISTRATIONS.filter((registration) => registration.channel === channel);
}
