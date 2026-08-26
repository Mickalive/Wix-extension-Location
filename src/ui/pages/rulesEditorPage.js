/**
 * Rules editor page — the dashboard configuration surface.
 *
 * Directive coverage: weekly windows per location and per service, split
 * windows (unlimited rows per weekday), dated exceptions (closed all day /
 * open override), caps per day / service / location, validation issues,
 * loading/error/empty and save/apply states, accessible keyboard-friendly
 * controls, preview/explanation before destructive changes.
 *
 * Honest platform framing (Contract section 12): the locations section states
 * plainly that Wix has no native per-location hours object and describes what
 * our mechanism does; the caps section discloses the concurrent-checkout
 * residual risk verbatim. No capability is overclaimed anywhere.
 *
 * Save/Apply are never silent: both drive a visible status region
 * (role="status") with pending/unavailable/saved/applied feedback.
 *
 * Mutation lifecycle (DASH-C3-1; Blueprint §4 flow 3): a confirmed apply
 * polls bridge.getMutationStatus(planId) via the bounded controller in
 * state/mutationPoller.js until the journal reaches a TERMINAL state
 * (APPLY_COMPLETED / ROLLED_BACK / RECOVERED / any other non-allowlisted
 * state) and renders that outcome in the role="status" region. Polling stops
 * permanently on the first terminal state or bridge error and is hard-bounded
 * (no infinite loop). Crash-mid-apply recovery is offered ONLY as an explicit
 * button ("Recover interrupted apply") that calls bridge.recover(scope) on
 * click; nothing on this page ever auto-retries or auto-applies a destructive
 * operation (Contract §9.2).
 *
 * Entitlement coverage (DASH-C5-1; Contract §7 management-side restriction,
 * Blueprint §4 flow 5): the page loads the billable-location meter through
 * the typed bridge method getEntitlementMeter() (pinned v1 DTO, consumed
 * verbatim) and restricts NEW rule configuration for locations OUTSIDE
 * coverage.allowedLocationIds (badged + disabled, with the stable-ordering
 * note). EXISTING configuration for uncovered locations stays rendered
 * read-only and is never deleted or silently dropped (§7); any control whose
 * current value contributes a validation issue stays correctable, so
 * restriction can never trap the editor in a permanently invalid draft.
 * Degraded coverage fails OPEN exactly like enforcement (C5): a persistent
 * warning renders, but nobody is restricted off an unreliable list.
 * meter.degraded shows the persistent fail-open warning banner without
 * bricking editing. overLimit surfaces the Contract §7 upgrade CTA (exact
 * buildUpgradeUrl contract, opened in a NEW TAB) alongside the Locations
 * usage page; identifiers are host-injected and never fabricated. A missing
 * meter (documented 404 n/a) or a typed bridge failure degrades to today's
 * unrestricted editor behind a non-blocking notice — never a crash.
 */

import { el } from '../dom/kit.js';
import { computeScheduleDiff } from '../diff/computeScheduleDiff.js';
import { openDiffPreviewModal } from '../modals/diffPreviewModal.js';
import { renderExplainPanel } from '../explain/explainPanel.js';
import { describeBridgeFailure } from '../state/editorStore.js';
import { pollMutationUntilTerminal } from '../state/mutationPoller.js';
import { buildUpgradeUrl } from '../upgrade/upgradeUrl.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const LOCATIONS_DISCLOSURE =
  'Wix Bookings has no native per-location hours object: every business location shares the same opening hours. ' +
  'This app delivers different hours by location through working-hours events on staff schedules, so each change below is shown to you for review before it touches any schedule.';

const CAPS_DISCLOSURE =
  'Daily and per-service limits are checked when a booking is validated. Because two customers can check out at the same moment, a count can briefly exceed its limit; the app reconciles counts continuously afterwards.';

// --- Entitlement restriction copy (DASH-C5-1; honest wording, Contract §12) ---

const COVERAGE_BADGE = 'Not covered by your plan';

const COVERAGE_ORDERING_NOTE =
  'Coverage follows a fixed order: your default location first, then alphabetical.';

const RESTRICTION_NOTE_MANAGED =
  'Your plan does not manage this location, so new booking rules for it are disabled here.';

const RESTRICTION_NOTE_PRESERVED =
  'Its existing hours below stay saved and read-only — nothing is deleted. Bookings at this location are not controlled by this app’s rules.';

const NEW_RULES_LOCK_TITLE =
  'New booking rules for this location are disabled: your plan does not manage it.';

const READONLY_LOCK_TITLE = 'Read-only: this location is not covered by your plan.';

const REMOVE_LOCK_TITLE =
  'Saved hours for a location outside your plan cannot be removed here; nothing is deleted.';

const METER_NA_NOTICE =
  'Usage information is not available from the app backend yet, so plan coverage cannot be checked here. The editor stays fully editable.';

const METER_DEGRADED_LINE =
  'The counted-location total cannot be read right now. Your rules keep running; see the Locations usage page for details.';

const COVERAGE_DEGRADED_DEFAULT_LINE =
  'Entitlement coverage is temporarily unknown. Your rules keep running; the covered-location list may be incomplete.';

function scopeLabel(scopeType) {
  return scopeType === 'location' ? 'Location' : 'Service';
}

/**
 * @param {object} options
 * @param {import('../state/editorStore.js').createEditorStore} options.store
 * @param {import('../services/bridge.js').createServicesBridge} [options.bridge]
 * @param {UiDocument} [options.document]
 * @param {Array<{decision:string,ruleId:string,code:string,customerMessage:string}>} [options.explanations]
 * @param {{maxAttempts?: number, delayMs?: number, delayFn?: (ms: number) => Promise<void>}} [options.pollOptions]
 *   Bounded mutation-status polling controls; tests inject an immediate
 *   delayFn and a small maxAttempts for deterministic offline runs.
 */
export function renderRulesEditorPage(options) {
  const doc = options.document;
  const store = options.store;
  const bridge = options.bridge ?? null;
  const pollOptions = options.pollOptions ?? {};
  let destroyed = false;

  const root = el('div', { class: 'rules-editor-page', 'data-testid': 'rules-editor-page' });
  const dynamic = el('div', { class: 'dynamic' });
  root.append(
    el('header', {},
      el('h1', { text: 'Advanced booking rules' }),
      el('p', {
        class: 'intro',
        text: 'Control when, where and under what conditions Wix Bookings reservations may happen.',
      }),
    ),
    dynamic,
  );

  let modalController = null;

  // -------------------------------------------------------------------
  // Entitlement coverage (DASH-C5-1; Contract §7 management-side
  // restriction; Blueprint §4 flow 5). Consumed through the typed bridge
  // method getEntitlementMeter() ONLY — never transport directly. The
  // pinned v1 DTO is consumed verbatim; nothing here reshapes it.
  //
  // Posture:
  //   - healthy coverage: locations OUTSIDE coverage.allowedLocationIds
  //     are visibly restricted for NEW rule configuration (badged +
  //     disabled). EXISTING configuration for those locations stays
  //     rendered read-only and is never deleted or silently dropped (§7).
  //     Any control whose current value contributes a validation issue
  //     stays correctable, so restriction can never trap the editor in a
  //     permanently invalid state.
  //   - degraded coverage fails OPEN exactly like enforcement (C5): the
  //     editor warns persistently but restricts nobody based on an
  //     unreliable list.
  //   - meter.degraded (count unreadable): persistent fail-open warning
  //     banner; editing is never bricked blindly.
  //   - overLimit: the Contract §7 upgrade CTA (buildUpgradeUrl contract,
  //     NEW TAB) renders alongside the Locations usage page. Identifiers
  //     are host-injected and never fabricated.
  //   - 404/null meter (the endpoint may be absent pre-integration of
  //     newer platform code): the editor degrades to today's unrestricted
  //     form behind a non-blocking info notice — never a crash. Typed
  //     bridge failures behave the same with honest wording.
  // -------------------------------------------------------------------

  const upgradeIdentifiers = options.upgrade ?? {};
  /** @type {{status:'idle'|'loading'|'ready'|'na'|'unavailable', dto: object|null, errorMessage: string|null}} */
  let entitlement = { status: 'idle', dto: null, errorMessage: null };
  let meterLoadInFlight = false;

  async function loadEntitlementMeter() {
    if (meterLoadInFlight || destroyed) return;
    // Bridges predating the meter endpoint carry no source at all; the
    // editor stays unrestricted instead of inventing entitlement state.
    if (!bridge || typeof bridge.getEntitlementMeter !== 'function') return;
    meterLoadInFlight = true;
    try {
      const dto = await bridge.getEntitlementMeter();
      if (destroyed) return;
      entitlement =
        dto === null
          ? { status: 'na', dto: null, errorMessage: null }
          : { status: 'ready', dto, errorMessage: null };
    } catch (error) {
      if (destroyed) return;
      entitlement = {
        status: 'unavailable',
        dto: null,
        errorMessage: describeBridgeFailure(error, 'Loading usage'),
      };
    } finally {
      meterLoadInFlight = false;
    }
    renderDynamic();
  }

  /**
   * Derives the page-wide restriction context from the loaded meter.
   * `restrictsLocation` is null whenever the covered-location list must not
   * be trusted for restriction (no reading yet, or degraded coverage —
   * enforcement fails open in that case, so restricting here would misstate
   * what the rules actually enforce).
   */
  function entitlementContext(issuePaths) {
    if (entitlement.status !== 'ready' || !entitlement.dto) {
      return { ready: false, restrictsLocation: null, overLimit: false, issuePaths };
    }
    const { coverage } = entitlement.dto;
    if (coverage.degraded === true) {
      return { ready: true, restrictsLocation: null, overLimit: coverage.overLimit === true, issuePaths };
    }
    const allowed = new Set(coverage.allowedLocationIds);
    return {
      ready: true,
      restrictsLocation: (id) => !allowed.has(id),
      overLimit: coverage.overLimit === true,
      issuePaths,
    };
  }

  function locationIsRestricted(ctx, locationId) {
    return (
      ctx.ready === true &&
      typeof ctx.restrictsLocation === 'function' &&
      ctx.restrictsLocation(locationId)
    );
  }

  /**
   * Contract §7 upgrade entry point for the editor (mirrors the Locations
   * usage page). Rendered only when coverage.overLimit holds AND both
   * identifiers were provided validly — identifiers are never fabricated,
   * so an unbuildable link degrades to the notice text alone.
   */
  function buildUpgradeCta() {
    let href = null;
    try {
      href = buildUpgradeUrl(upgradeIdentifiers.appId, upgradeIdentifiers.instanceId);
    } catch {
      href = null;
    }
    if (href === null) return null;
    return el('a', {
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'upgrade-cta',
      'data-testid': 'editor-upgrade-cta',
      'aria-label': 'Upgrade to manage more locations (opens in a new tab)',
      text: 'Upgrade to manage more locations',
    });
  }

  /**
   * Page-level entitlement region: persistent fail-open warning banner
   * (role="alert"), over-limit section with the upgrade CTA, or the
   * non-blocking notices for the documented 404 n/a and typed load
   * failures. Returns an array of nodes (empty while idle/loading — the
   * editor stays interactive from the first paint either way).
   */
  function entitlementRegion() {
    const nodes = [];
    if (entitlement.status === 'ready' && entitlement.dto) {
      const { meter, coverage } = entitlement.dto;
      const lines = [];
      if (coverage.degraded === true) {
        lines.push(coverage.warning ?? COVERAGE_DEGRADED_DEFAULT_LINE);
      } else if (typeof coverage.warning === 'string' && coverage.warning.length > 0) {
        lines.push(coverage.warning);
      }
      if (meter.degraded === true) {
        lines.push(METER_DEGRADED_LINE);
      }
      if (lines.length > 0) {
        nodes.push(
          el(
            'div',
            { role: 'alert', class: 'degraded-banner', 'data-testid': 'editor-degraded-banner' },
            ...lines.map((line) => el('p', { 'data-testid': 'editor-degraded-banner-line', text: line })),
          ),
        );
      }
      if (coverage.overLimit === true) {
        const cta = buildUpgradeCta();
        nodes.push(
          el(
            'section',
            { 'data-testid': 'editor-over-limit-section', 'aria-label': 'Over your plan’s location limit' },
            el('h2', { text: 'Over your plan’s location limit' }),
            el('p', {
              'data-testid': 'editor-over-limit-explanation',
              text:
                'Locations beyond the plan’s managed set are not controlled by this app’s rules. Their settings are preserved — nothing was deleted — and upgrading adds them back to coverage.',
            }),
            el('p', { class: 'disclosure', 'data-testid': 'editor-ordering-note', text: COVERAGE_ORDERING_NOTE }),
            ...(cta ? [cta] : []),
          ),
        );
      }
    } else if (entitlement.status === 'na') {
      nodes.push(
        el('p', {
          role: 'status',
          'aria-live': 'polite',
          'data-testid': 'meter-na-notice',
          text: METER_NA_NOTICE,
        }),
      );
    } else if (entitlement.status === 'unavailable') {
      nodes.push(
        el('p', {
          role: 'status',
          'aria-live': 'polite',
          'data-testid': 'meter-error-notice',
          text: `${entitlement.errorMessage ?? 'Usage information could not be loaded.'} The editor stays fully editable.`,
        }),
      );
    }
    return nodes;
  }

  function statusRegion(state) {
    const messages = [];
    if (state.saveStatus === 'pending') messages.push('Saving draft…');
    if (state.saveStatus === 'saved') messages.push(state.lastSaveMessage ?? 'Draft saved.');
    if (state.saveStatus === 'unavailable') messages.push(state.lastSaveMessage ?? 'Save is unavailable right now.');
    if (state.applyStatus === 'pending') messages.push('Applying schedule changes…');
    if (state.applyStatus === 'applied') messages.push(state.lastApplyMessage ?? 'Schedule changes applied.');
    if (state.applyStatus === 'rolled_back') messages.push(state.lastApplyMessage ?? 'The change set did not apply cleanly; schedules were rolled back.');
    if (state.applyStatus === 'recovered') messages.push(state.lastApplyMessage ?? 'An interrupted apply was recovered; schedules were restored.');
    if (state.applyStatus === 'failed') messages.push(state.lastApplyMessage ?? 'The apply ended in an unresolved state.');
    if (state.applyStatus === 'unavailable') messages.push(state.lastApplyMessage ?? 'Apply is unavailable right now.');
    if (state.recoverStatus === 'pending') messages.push('Checking the interrupted change set for recovery…');
    if (state.recoverStatus === 'unavailable') messages.push(state.lastRecoverMessage ?? 'Recovery is unavailable right now.');
    if (state.recoverStatus === 'done') {
      const summary = state.lastRecoverySummary;
      if (!summary) {
        messages.push(state.lastRecoverMessage ?? 'Nothing was pending for this schedule; nothing needed recovery.');
      } else if (summary.complete === true) {
        messages.push(`Recovery completed: schedules restored to their pre-apply state (change set ${summary.planId}).`);
      } else {
        messages.push('Recovery finished with unresolved items — see the details below.');
      }
    }
    return el(
      'div',
      { role: 'status', 'data-testid': 'action-status', 'aria-live': 'polite' },
      ...messages.map((message) => el('p', { text: message })),
    );
  }

  /**
   * Structured RecoverySummary details (rendered only after an explicit,
   * user-initiated recover). Mismatches and notes are shown verbatim so the
   * outcome is never prettified into a false "all good".
   */
  function recoveryRegion(state) {
    if (state.recoverStatus !== 'done' || !state.lastRecoverySummary) {
      return el('div', { 'data-testid': 'recovery-region' });
    }
    const summary = state.lastRecoverySummary;
    const items = [
      ...(Array.isArray(summary.mismatches) ? summary.mismatches : []).map((entry) =>
        el('li', { 'data-testid': 'recovery-mismatch', text: String(entry) }),
      ),
      ...(Array.isArray(summary.notes) ? summary.notes : []).map((entry) =>
        el('li', { 'data-testid': 'recovery-note', text: String(entry) }),
      ),
    ];
    return el(
      'div',
      { 'data-testid': 'recovery-region', role: 'status', 'aria-live': 'polite' },
      el('p', {
        'data-testid': 'recovery-summary',
        text:
          summary.complete === true
            ? `Recovery reference ${summary.auditEntryId ?? '(no audit reference)'}: schedules match their pre-apply snapshot.`
            : `Recovery reference ${summary.auditEntryId ?? '(no audit reference)'}: unresolved items remain.`,
      }),
      items.length > 0 ? el('ul', { 'data-testid': 'recovery-details' }, ...items) : null,
    );
  }

  function issuesRegion(state) {
    const container = el('div', { 'data-testid': 'issues-region' });
    if (state.notice) {
      container.append(el('p', { role: 'alert', 'data-testid': 'notice', text: state.notice.message }));
    }
    if (state.issues.length > 0) {
      container.append(
        el(
          'div',
          {
            role: 'alert',
            'data-testid': 'issues-list',
            class: 'issues',
          },
          el('p', {
            text: `${state.issues.length} problem${state.issues.length === 1 ? '' : 's'} must be fixed before changes can be reviewed or applied:`,
          }),
          el(
            'ul',
            {},
            ...state.issues.map((issue) => el('li', { 'data-testid': 'issue-item', text: issue.message })),
          ),
        ),
      );
    }
    return container;
  }

  /**
   * One weekly-window row. `ctx` carries the entitlement restriction
   * context (DASH-C5-1): for a location OUTSIDE the plan's covered set the
   * row's time inputs are disabled (existing configuration stays rendered
   * read-only, never deleted) and new rows cannot be added. Anti-trap rule:
   * a row that currently contributes a validation issue (its own path, or a
   * bucket-level issue such as an overlap, which does not identify the
   * offending pair) keeps its Remove control enabled so the editor can
   * always reach a clean, reviewable state; only valid existing
   * configuration has no deletion path.
   */
  function windowRow(scopeType, scopeId, weekday, index, row, ctx) {
    const restricted = scopeType === 'location' && locationIsRestricted(ctx, scopeId);
    const rowPath = `${scopeType}s.${scopeId}.${weekday}[${index}]`;
    const bucketPath = `${scopeType}s.${scopeId}.${weekday}`;
    const rowContributesIssue = ctx.issuePaths.has(rowPath) || ctx.issuePaths.has(bucketPath);
    const lockRemove = restricted && !rowContributesIssue;
    const inputLockTitle = restricted ? READONLY_LOCK_TITLE : undefined;
    const rowNode = el('li', { 'data-testid': `window-row-${scopeType}-${scopeId}-${weekday}-${index}` });
    const startInput = el('input', {
      type: 'text',
      value: row.start ?? '',
      placeholder: 'HH:MM',
      disabled: restricted,
      title: inputLockTitle,
      'data-testid': `window-start-${scopeType}-${scopeId}-${weekday}-${index}`,
      'aria-label': `${scopeLabel(scopeType)} ${scopeId}, ${weekday}, window ${index + 1} start time`,
      onchange: (event) => {
        store.dispatch({
          type: 'PATCH_WEEK_WINDOW',
          scopeType,
          scopeId,
          weekday,
          index,
          patch: { start: event.target.value },
        });
      },
    });
    const endInput = el('input', {
      type: 'text',
      value: row.end ?? '',
      placeholder: 'HH:MM',
      disabled: restricted,
      title: inputLockTitle,
      'data-testid': `window-end-${scopeType}-${scopeId}-${weekday}-${index}`,
      'aria-label': `${scopeLabel(scopeType)} ${scopeId}, ${weekday}, window ${index + 1} end time`,
      onchange: (event) => {
        store.dispatch({
          type: 'PATCH_WEEK_WINDOW',
          scopeType,
          scopeId,
          weekday,
          index,
          patch: { end: event.target.value },
        });
      },
    });
    rowNode.append(
      el('span', { class: 'weekday-chip', text: weekday }),
      startInput,
      el('span', { text: '–' }),
      endInput,
      el(
        'button',
        {
          type: 'button',
          'data-testid': `window-remove-${scopeType}-${scopeId}-${weekday}-${index}`,
          'aria-label': `Remove ${weekday} window ${index + 1} for ${scopeLabel(scopeType)} ${scopeId}`,
          disabled: lockRemove,
          title: lockRemove ? REMOVE_LOCK_TITLE : undefined,
          onClick: () =>
            store.dispatch({ type: 'REMOVE_WEEK_WINDOW', scopeType, scopeId, weekday, index }),
        },
        'Remove',
      ),
    );
    return rowNode;
  }

  function windowsSection(scopeType, scopes, catalog, ctx) {
    const section = el(
      'section',
      { 'data-testid': `${scopeType}-windows-section`, 'aria-label': `${scopeLabel(scopeType)} booking hours` },
      el('h2', { text: scopeType === 'location' ? 'Hours by location' : 'Hours by service' }),
    );
    if (scopeType === 'location') {
      section.append(el('p', { class: 'disclosure', 'data-testid': 'locations-disclosure', text: LOCATIONS_DISCLOSURE }));
    }
    if (catalog.length === 0) {
      section.append(
        el('p', {
          'data-testid': `${scopeType}-empty`,
          text:
            scopeType === 'location'
              ? 'No locations are available yet. Connect the app to load your Wix Bookings locations.'
              : 'No services are available yet. Connect the app to load your Wix Bookings services.',
        }),
      );
      return section;
    }
    for (const entry of catalog) {
      const bucket = scopes[entry.id] ?? {};
      const restricted = scopeType === 'location' && locationIsRestricted(ctx, entry.id);
      const scopeBlock = el(
        'fieldset',
        { 'data-testid': `${scopeType}-scope-${entry.id}` },
        el('legend', { text: `${scopeLabel(scopeType)}: ${entry.label} (${entry.id})` }),
      );
      if (restricted) {
        // DASH-C5-1: visible plan restriction for NEW rule configuration.
        // The note carries the stable-ordering phrase pinned by Contract §7
        // ("default location first, then alphabetical") and the §7
        // nothing-deleted reassurance for the read-only existing config.
        scopeBlock.append(
          el('span', {
            class: 'coverage-badge',
            'data-testid': `coverage-badge-${entry.id}`,
            text: COVERAGE_BADGE,
          }),
          el(
            'div',
            { class: 'coverage-note', 'data-testid': `coverage-note-${entry.id}` },
            el('p', { text: RESTRICTION_NOTE_MANAGED }),
            el('p', { text: RESTRICTION_NOTE_PRESERVED }),
            el('p', { text: COVERAGE_ORDERING_NOTE }),
          ),
        );
      }
      for (const weekday of WEEKDAYS) {
        const rows = Array.isArray(bucket[weekday]) ? bucket[weekday] : [];
        const dayBlock = el(
          'div',
          { 'data-testid': `${scopeType}-${entry.id}-${weekday}`, class: 'weekday-block' },
          el('h4', { text: weekday }),
        );
        const list = el('ul', { class: 'window-rows' });
        rows.forEach((row, index) => list.append(windowRow(scopeType, entry.id, weekday, index, row, ctx)));
        dayBlock.append(list);
        dayBlock.append(
          el(
            'button',
            {
              type: 'button',
              'data-testid': `add-window-${scopeType}-${entry.id}-${weekday}`,
              disabled: restricted,
              title: restricted ? NEW_RULES_LOCK_TITLE : undefined,
              onClick: () =>
                store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType, scopeId: entry.id, weekday }),
            },
            `Add ${weekday} window`,
          ),
        );
        scopeBlock.append(dayBlock);
      }
      section.append(scopeBlock);
    }
    return section;
  }

  function exceptionsSection(draft) {
    const section = el(
      'section',
      { 'data-testid': 'exceptions-section', 'aria-label': 'Date exceptions' },
      el('h2', { text: 'Date exceptions' }),
      el('p', {
        class: 'disclosure',
        text: 'Close a specific date entirely, or override it with different opening hours (for example a holiday or a one-off late opening).',
      }),
      el(
        'button',
        {
          type: 'button',
          'data-testid': 'add-exception',
          onClick: () => store.dispatch({ type: 'ADD_EXCEPTION', date: '' }),
        },
        'Add exception',
      ),
    );
    if (draft.exceptions.length === 0) {
      section.append(
        el('p', {
          'data-testid': 'exceptions-empty',
          text: 'No date exceptions yet. Your regular weekly hours apply to every date.',
        }),
      );
      return section;
    }
    for (const exception of draft.exceptions) {
      const id = exception.exceptionId;
      const block = el('fieldset', { 'data-testid': `exception-${id}` });
      block.append(
        el('legend', { text: exception.date ? `Exception ${exception.date}` : 'New exception' }),
      );
      block.append(
        el('input', {
          type: 'text',
          value: exception.date ?? '',
          placeholder: 'YYYY-MM-DD',
          'aria-label': `Exception date${exception.date ? ` (currently ${exception.date})` : ''}`,
          'data-testid': `exception-date-${id}`,
          onchange: (event) =>
            store.dispatch({
              type: 'UPDATE_EXCEPTION',
              exceptionId: id,
              patch: { date: event.target.value },
            }),
        }),
        (() => {
          const select = el(
            'select',
            {
              'aria-label': `Exception type for ${exception.date || 'new exception'}`,
              'data-testid': `exception-kind-${id}`,
              onchange: (event) =>
                store.dispatch({
                  type: 'UPDATE_EXCEPTION',
                  exceptionId: id,
                  patch: { kind: event.target.value },
                }),
            },
            el('option', { value: 'CLOSED', selected: exception.kind === 'CLOSED', text: 'Closed all day' }),
            el('option', { value: 'OVERRIDE', selected: exception.kind === 'OVERRIDE', text: 'Open override' }),
          );
          return select;
        })(),
      );
      if (exception.kind === 'OVERRIDE') {
        const windows = Array.isArray(exception.windows) ? exception.windows : [{ start: '', end: '' }];
        const list = el('ul', { 'data-testid': `exception-windows-${id}` });
        windows.forEach((w, index) => {
          list.append(
            el(
              'li',
              { 'data-testid': `exception-window-${id}-${index}` },
              el('input', {
                type: 'text',
                value: w.start ?? '',
                placeholder: 'HH:MM',
                'aria-label': `Override window ${index + 1} start for ${exception.date || 'new exception'}`,
                'data-testid': `exception-window-start-${id}-${index}`,
                onchange: (event) => {
                  const next = windows.map((row) => ({ ...row }));
                  next[index] = { ...next[index], start: event.target.value };
                  store.dispatch({
                    type: 'UPDATE_EXCEPTION',
                    exceptionId: id,
                    patch: { windows: next },
                  });
                },
              }),
              el('input', {
                type: 'text',
                value: w.end ?? '',
                placeholder: 'HH:MM',
                'aria-label': `Override window ${index + 1} end for ${exception.date || 'new exception'}`,
                'data-testid': `exception-window-end-${id}-${index}`,
                onchange: (event) => {
                  const next = windows.map((row) => ({ ...row }));
                  next[index] = { ...next[index], end: event.target.value };
                  store.dispatch({
                    type: 'UPDATE_EXCEPTION',
                    exceptionId: id,
                    patch: { windows: next },
                  });
                },
              }),
            ),
          );
        });
        block.append(list);
        block.append(
          el(
            'button',
            {
              type: 'button',
              'data-testid': `exception-add-window-${id}`,
              onClick: () => {
                const next = [...(Array.isArray(exception.windows) ? exception.windows : []), { start: '', end: '' }];
                store.dispatch({ type: 'UPDATE_EXCEPTION', exceptionId: id, patch: { windows: next } });
              },
            },
            'Add override window',
          ),
        );
      }
      block.append(
        el('input', {
          type: 'text',
          value: exception.note ?? '',
          placeholder: 'Note (optional)',
          'aria-label': `Note for exception ${exception.date || '(no date)'}`,
          'data-testid': `exception-note-${id}`,
          onchange: (event) =>
            store.dispatch({
              type: 'UPDATE_EXCEPTION',
              exceptionId: id,
              patch: { note: event.target.value },
            }),
        }),
        el(
          'button',
          {
            type: 'button',
            'data-testid': `exception-remove-${id}`,
            onClick: () => store.dispatch({ type: 'REMOVE_EXCEPTION', exceptionId: id }),
          },
          'Remove exception',
        ),
      );
      section.append(block);
    }
    return section;
  }

  function limitInput(dimension, targetId, current, lock = false) {
    return el('input', {
      type: 'text',
      inputmode: 'numeric',
      value: current === null || current === undefined ? '' : String(current),
      placeholder: 'No limit',
      disabled: lock === true,
      title: lock === true ? READONLY_LOCK_TITLE : undefined,
      'aria-label':
        targetId
          ? `Maximum bookings per ${dimension.toLowerCase()}${dimension !== 'DAY' ? ` for ${targetId}` : ''}`
          : `Maximum bookings per day`,
      'data-testid': `limit-${dimension}${targetId ? `-${targetId}` : ''}`,
      onchange: (event) =>
        store.dispatch({
          type: 'SET_LIMIT',
          dimension,
          targetId: targetId ?? null,
          rawValue: event.target.value.trim(),
        }),
    });
  }

  function capsSection(draft, ctx) {
    const findLimit = (dimension, targetId) => {
      const found = draft.limits.find(
        (l) => l.dimension === dimension && (l.targetId ?? null) === (targetId ?? null),
      );
      return found ? found.maxCount : null;
    };
    const section = el(
      'section',
      { 'data-testid': 'caps-section', 'aria-label': 'Booking limits' },
      el('h2', { text: 'Booking limits' }),
      el('p', { class: 'disclosure', 'data-testid': 'caps-disclosure', text: CAPS_DISCLOSURE }),
      el(
        'div',
        { 'data-testid': 'cap-day' },
        el('label', { text: 'Maximum bookings per day (all services)' }),
        limitInput('DAY', null, findLimit('DAY', null)),
      ),
    );
    if (options.services && options.services.length > 0) {
      const serviceBlock = el('fieldset', { 'data-testid': 'cap-service-block' }, el('legend', { text: 'Per-service limits' }));
      for (const service of options.services) {
        serviceBlock.append(
          el(
            'div',
            {},
            el('label', { text: `${service.label} (${service.id})` }),
            limitInput('SERVICE', service.id, findLimit('SERVICE', service.id)),
          ),
        );
      }
      section.append(serviceBlock);
    }
    if (options.locations && options.locations.length > 0) {
      const locationBlock = el('fieldset', { 'data-testid': 'cap-location-block' }, el('legend', { text: 'Per-location limits' }));
      for (const location of options.locations) {
        // DASH-C5-1: a per-location cap is rule configuration for that
        // location, so it locks under restriction too. Same anti-trap rule
        // as window rows: a limit whose current value contributes a
        // validation issue stays correctable.
        const restricted = locationIsRestricted(ctx, location.id);
        const lock = restricted && !ctx.issuePaths.has(`limits.LOCATION.${location.id}`);
        locationBlock.append(
          el(
            'div',
            {},
            el('label', { text: `${location.label} (${location.id})` }),
            limitInput('LOCATION', location.id, findLimit('LOCATION', location.id), lock),
          ),
        );
      }
      section.append(locationBlock);
    }
    return section;
  }

  function actionButtons(state) {
    const issueCount = state.issues.length;
    const reviewTitle =
      issueCount > 0
        ? `Fix ${issueCount} validation issue${issueCount === 1 ? '' : 's'} before reviewing changes.`
        : 'See exactly which schedule changes your edits produce.';
    const reviewButton = el(
      'button',
      {
        type: 'button',
        'data-testid': 'review-changes',
        disabled: issueCount > 0,
        title: reviewTitle,
        'aria-describedby': issueCount > 0 ? 'issues-list' : undefined,
        onClick: () => store.dispatch({ type: 'OPEN_DIFF_PREVIEW' }),
      },
      'Review changes',
    );
    const applyButton = el(
      'button',
      {
        type: 'button',
        'data-testid': 'apply-changes',
        disabled: !store.canApply() || state.applyStatus === 'pending',
        title: store.canApply()
          ? 'Apply the confirmed changes to your schedules.'
          : 'Review and confirm the diff first; apply unlocks after confirmation.',
        onClick: () => void handleApply(),
      },
      state.applyStatus === 'pending' ? 'Applying…' : 'Apply to schedules',
    );
    const saveButton = el(
      'button',
      {
        type: 'button',
        'data-testid': 'save-draft',
        disabled: state.saveStatus === 'pending',
        title: 'Save this draft as the active rule set.',
        onClick: () => void handleSave(),
      },
      state.saveStatus === 'pending' ? 'Saving…' : 'Save draft',
    );
    const controls = [saveButton, reviewButton, applyButton];
    const recoverControl = buildRecoverControl(state);
    if (recoverControl) controls.push(recoverControl);
    return el(
      'div',
      { class: 'actions', 'data-testid': 'page-actions' },
      ...controls,
    );
  }

  /**
   * Explicit crash-mid-apply recovery affordance (T-RB1 UX counterpart).
   *
   * Rendered ONLY when this editor actually tracked an interrupted or
   * unresolved change set (a journal observation with a known scope) and the
   * outcome is not already a clean terminal state. The bridge call happens
   * exclusively inside the click handler — nothing renders, polls or times
   * its way into a destructive recovery without explicit user intent
   * (Contract §9.2). Returns null when there is nothing to recover.
   */
  function buildRecoverControl(state) {
    if (!state.lastMutation || !state.lastMutation.scope) return null;
    // Clean terminals need no recovery.
    if (state.applyStatus === 'applied' || state.applyStatus === 'rolled_back' || state.applyStatus === 'recovered') {
      return null;
    }
    // An apply still being polled must never be disturbed by a concurrent
    // recovery: hide the affordance until the attempt reaches a resolution.
    if (state.applyStatus === 'pending') return null;
    const pending = state.recoverStatus === 'pending';
    return el(
      'button',
      {
        type: 'button',
        'data-testid': 'recover-interrupted',
        disabled: pending,
        title:
          'Checks the interrupted change set for this schedule and restores your schedules to their pre-apply state. Runs only when you click it.',
        onClick: () => void handleRecover(),
      },
      pending ? 'Recovering…' : 'Recover interrupted apply',
    );
  }

  async function handleSave() {
    if (!bridge) {
      store.dispatch({
        type: 'SAVE_UNAVAILABLE',
        message: 'Save is unavailable: the app backend is not connected yet. Your draft stays in this editor.',
      });
      return;
    }
    store.dispatch({ type: 'SAVE_START' });
    try {
      const saved = await bridge.saveRuleSet(store.getState().draft);
      store.dispatch({ type: 'SAVE_SUCCESS', savedRuleSet: saved });
    } catch (error) {
      store.dispatch({
        type: 'SAVE_UNAVAILABLE',
        message: describeBridgeFailure(error, 'Save'),
      });
    }
  }

  async function handleApply() {
    const state = store.getState();
    if (!store.canApply()) {
      store.dispatch({
        type: 'APPLY_UNAVAILABLE',
        message: 'Apply is locked until you review the proposed changes and confirm them in the dialog.',
      });
      return;
    }
    if (!bridge) {
      store.dispatch({
        type: 'APPLY_UNAVAILABLE',
        message: 'Apply is unavailable: the app backend is not connected yet. Nothing was changed.',
      });
      return;
    }
    const draftAtApply = JSON.parse(JSON.stringify(state.draft));
    store.dispatch({ type: 'APPLY_START' });
    try {
      const { ops } = computeScheduleDiff(state.savedRuleSet, state.draft);
      const response = await bridge.requestApply(ops, state.confirmedHash);
      // The accepted apply-plan response carries `{ summary: MutationSummary }`;
      // its planId is the journal key the status endpoint polls.
      const planId = response?.summary?.planId;
      if (typeof planId !== 'string' || planId === '') {
        // Never claim success without a confirmable outcome reference.
        store.dispatch({
          type: 'APPLY_FAILED',
          message:
            'The apply result could not be confirmed: the server response did not include a change-set reference. Nothing will change on its own; check your schedules before trying again.',
        });
        return;
      }
      const outcome = await pollMutationUntilTerminal({
        getStatus: () => bridge.getMutationStatus(planId),
        onObservation: (projection) => {
          if (destroyed) return;
          store.dispatch({
            type: 'MUTATION_TRACKED',
            planId: typeof projection.planId === 'string' ? projection.planId : planId,
            scope: projection.scope ?? null,
            state: typeof projection.state === 'string' ? projection.state : null,
          });
        },
        isCancelled: () => destroyed,
        maxAttempts: pollOptions.maxAttempts,
        delayMs: pollOptions.delayMs,
        delayFn: pollOptions.delayFn,
      });
      dispatchApplyOutcome(outcome, draftAtApply);
    } catch (error) {
      store.dispatch({
        type: 'APPLY_UNAVAILABLE',
        message: describeBridgeFailure(error, 'Apply'),
      });
    }
  }

  /**
   * Audit N-A (CYCLE_32792897988_DASHBOARD): the "Recover interrupted apply"
   * affordance requires a tracked ScheduleScope, so failed-state guidance may
   * mention it ONLY when state.lastMutation?.scope is known. Without a scope
   * the sentence would be unfollowable — exactly the first-probe-failure /
   * all-null-probe states where no observation ever carried one.
   */
  function hasRecoverableScope() {
    return Boolean(store.getState().lastMutation?.scope);
  }

  /** Maps one bounded-poll outcome to the visible terminal apply state. */
  function dispatchApplyOutcome(outcome, draftAtApply) {
    switch (outcome.kind) {
      case 'APPLIED':
        store.dispatch({
          type: 'APPLY_SUCCESS',
          savedRuleSet: draftAtApply,
          message: 'Schedule changes applied.',
        });
        return;
      case 'ROLLED_BACK':
        store.dispatch({
          type: 'APPLY_ROLLED_BACK',
          message:
            'The change set did not apply completely: your schedules were rolled back to their previous state. Nothing was changed. You can adjust the draft, then review and try again.',
        });
        return;
      case 'RECOVERED':
        store.dispatch({
          type: 'APPLY_RECOVERED',
          message:
            'An interrupted apply was recovered on the server: your schedules were restored to their previous state.',
        });
        return;
      case 'FAILED_TERMINAL':
        store.dispatch({
          type: 'APPLY_FAILED',
          message:
            `The apply ended in an unresolved state (${outcome.state}). It will not progress on its own.` +
            (hasRecoverableScope()
              ? ' Use “Recover interrupted apply” to restore your schedules.'
              : ''),
        });
        return;
      case 'EXHAUSTED':
        store.dispatch({
          type: 'APPLY_FAILED',
          message:
            `The apply result could not be confirmed after ${outcome.attempts} checks.` +
            (hasRecoverableScope()
              ? ' Use “Recover interrupted apply” if your schedules seem stuck, or check back later.'
              : ' Check back later.'),
        });
        return;
      case 'ERROR':
        store.dispatch({
          type: 'APPLY_FAILED',
          message:
            `${describeBridgeFailure(outcome.error, 'Apply')} It is not known whether the change set completed.` +
            (hasRecoverableScope()
              ? ' Use “Recover interrupted apply” if your schedules seem stuck.'
              : ''),
        });
        return;
      default:
        // CANCELLED (page torn down): no UI left to update; deliberately silent.
        return;
    }
  }

  /**
   * Explicit user-initiated recovery (T-RB1 UX counterpart). Reached ONLY
   * from the recover button's click handler — never from rendering, polling
   * or timers.
   *
   * Audit N-B (CYCLE_32792897988_DASHBOARD): same-tick synthetic multi-clicks
   * can reach this handler before the disabled re-render lands, so a trivial
   * synchronous in-flight guard collapses them into one bridge call. Server
   * recovery is idempotent anyway; this keeps the client honest too.
   */
  let recoverInFlight = false;

  async function handleRecover() {
    if (recoverInFlight) return;
    const state = store.getState();
    const scope = state.lastMutation?.scope ?? null;
    if (!bridge || !scope) {
      store.dispatch({
        type: 'RECOVER_UNAVAILABLE',
        message: 'Recovery is unavailable: this editor has not tracked an interrupted change set with a known schedule.',
      });
      return;
    }
    recoverInFlight = true;
    store.dispatch({ type: 'RECOVER_START' });
    try {
      const recovery = await bridge.recover(scope);
      store.dispatch({
        type: 'RECOVER_RESULT',
        summary: recovery ?? null,
        message: recovery ? null : 'Nothing was pending for this schedule; nothing needed recovery.',
      });
    } catch (error) {
      store.dispatch({
        type: 'RECOVER_UNAVAILABLE',
        message: describeBridgeFailure(error, 'Recovery'),
      });
    } finally {
      recoverInFlight = false;
    }
  }

  function maybeRenderModal(state) {
    if (!state.diffPreview.open) {
      if (modalController) {
        modalController.close();
        modalController = null;
      }
      return;
    }
    if (modalController) return; // already rendered for this open session
    modalController = openDiffPreviewModal({
      ops: computeScheduleDiff(state.savedRuleSet, state.draft).ops,
      renderedHash: state.diffPreview.renderedHash,
      canConfirm: store.canConfirmDiff(),
      blockingIssues: state.issues,
      document: doc,
      onConfirm: (hash) => {
        store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash });
        modalController?.close();
        modalController = null;
      },
      onCancel: () => {
        store.dispatch({ type: 'CLOSE_DIFF_PREVIEW' });
      },
    });
    doc.body.appendChild(modalController.root);
  }

  function renderDynamic() {
    const state = store.getState();
    const draft = state.draft;
    // Validation-issue paths drive the DASH-C5-1 anti-trap rule: controls
    // whose current value contributes an issue stay correctable even under
    // restriction, so the editor can always reach a clean reviewable state.
    const issuePaths = new Set(state.issues.map((issueEntry) => issueEntry.path));
    const ctx = entitlementContext(issuePaths);
    dynamic.replaceChildren(
      ...entitlementRegion(),
      issuesRegion(state),
      windowsSection('location', draft.locationWindows ?? {}, options.locations ?? [], ctx),
      windowsSection('service', draft.serviceWindows ?? {}, options.services ?? [], ctx),
      exceptionsSection(draft),
      capsSection(draft, ctx),
      renderExplainPanel(options.explanations ?? [], { document: doc }),
      statusRegion(state),
      recoveryRegion(state),
      actionButtons(state),
    );
    maybeRenderModal(state);
  }

  const unsubscribe = store.subscribe(() => renderDynamic());
  renderDynamic();
  // Entitlement meter loads in the background (DASH-C5-1); the editor is
  // fully interactive from the first paint regardless of the outcome.
  void loadEntitlementMeter();

  return {
    root,
    /**
     * Host-facing refresh seam (e.g. returning from the upgrade tab):
     * re-reads the entitlement meter through the same guarded path as the
     * initial load; concurrent calls collapse into one bridge request.
     */
    reload() {
      void loadEntitlementMeter();
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      if (modalController) {
        modalController.close();
        modalController = null;
      }
    },
  };
}
