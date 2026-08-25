/**
 * Locations usage page — billable-location meter (DASH-C4-1a; Blueprint §1
 * pages/LocationsUsage, §4 flow 5).
 *
 * Renders the composed entitlement reading delivered by the typed bridge
 * method `getEntitlementMeter()` against the PINNED cross-lane DTO:
 *
 *   { meter:    { count: number|null, degraded: boolean },
 *     coverage: { allowedLocationIds: string[], overLimit: boolean,
 *                 degraded: boolean, warning: string|null } }
 *
 * Contract §7 obligations made visible here:
 *   - count vs plan allowance (when over the limit, the allowance is exactly
 *     the number of covered ids — the stable-ordering cut point);
 *   - over-limit state with the stable-ordering note (default location first,
 *     then alphabetical by location id) and "nothing is deleted" reassurance;
 *   - PERSISTENT degraded-warning banner whenever any degraded flag or warning
 *     is present: the ratified fail-open posture must never render as
 *     silently healthy, and the positive "within your plan" note is suppressed
 *     whenever any degraded signal exists;
 *   - single-location floor note (computed 0 => treated as 1);
 *   - upgrade CTA implementing the buildUpgradeUrl contract, opened in a NEW
 *     tab, shown when `overLimit` or tier-restricted. Identifiers arrive
 *     injected from the dashboard host at scaffold time; they are never
 *     fabricated, so without them the restriction notice still renders but
 *     the link cannot.
 *
 * Honest counting copy (Contract §12.4): the page states exactly how a
 * billable location is counted, and claims no capability beyond what the
 * accepted contract classifies.
 *
 * Accessibility: loading uses role="status", degraded/error states use
 * role="alert"; every control is a native button or anchor; the covered list
 * preserves the backend's stable order verbatim (never reordered here).
 */

import { el } from '../dom/kit.js';
import { describeBridgeFailure } from '../state/editorStore.js';
import { buildUpgradeUrl } from '../upgrade/upgradeUrl.js';

const COUNTING_DISCLOSURE =
  'A location is counted when it exists in your Wix account (not archived) and at least one of your services takes place there. ' +
  'If no location is counted, this app still treats one location as managed.';

const STABLE_ORDERING_NOTE =
  'Covered locations are listed in a fixed order: your default location first, then alphabetical. ' +
  'When a site has more counted locations than the plan manages, coverage follows that same order.';

/**
 * @param {object} options
 * @param {import('../services/bridge.js').createServicesBridge} [options.bridge]
 * @param {UiDocument} [options.document]
 * @param {{appId?: string, instanceId?: string}} [options.upgrade]
 *   Dashboard-host-provided identifiers for the contracted upgrade URL.
 *   Injected at scaffold time; never fabricated. When absent or invalid the
 *   restriction notices still render but the upgrade link cannot.
 * @param {boolean} [options.isTierRestricted]
 *   Plan-state input wired by the host at scaffold time: true when the current
 *   plan restricts location management even though today's coverage is not yet
 *   over the limit. Shows the upgrade CTA independently of `overLimit`.
 */
export function renderLocationsUsagePage(options = {}) {
  const doc = options.document;
  const bridge = options.bridge ?? null;
  const upgradeIdentifiers = options.upgrade ?? {};
  const isTierRestricted = options.isTierRestricted === true;

  let destroyed = false;
  let loadInFlight = false;
  /** @type {{status:'loading'|'ready'|'na'|'unavailable', dto: object|null, errorMessage: string|null}} */
  let view = { status: 'loading', dto: null, errorMessage: null };

  const root = el('div', { class: 'locations-usage-page', 'data-testid': 'locations-usage-page' });
  const dynamic = el('div', { class: 'dynamic' });
  root.append(
    el(
      'header',
      {},
      el('h1', { text: 'Locations usage' }),
      el('p', {
        class: 'intro',
        text: 'See how many Wix Bookings locations this app manages against your plan, and which locations are covered.',
      }),
    ),
    dynamic,
  );

  async function load() {
    if (loadInFlight || destroyed) return;
    loadInFlight = true;
    try {
      if (!bridge) {
        view = {
          status: 'unavailable',
          dto: null,
          errorMessage:
            'Usage information is unavailable: the app backend is not connected yet. Nothing on your site was changed.',
        };
        render();
        return;
      }
      view = { status: 'loading', dto: null, errorMessage: null };
      render();
      const dto = await bridge.getEntitlementMeter();
      if (destroyed) return;
      if (dto === null) {
        view = { status: 'na', dto: null, errorMessage: null };
      } else {
        view = { status: 'ready', dto, errorMessage: null };
      }
    } catch (error) {
      if (destroyed) return;
      view = {
        status: 'unavailable',
        dto: null,
        errorMessage: describeBridgeFailure(error, 'Loading usage'),
      };
    } finally {
      loadInFlight = false;
    }
    render();
  }

  // ------------------------------------------------------------- fragments

  function degradedBanner(dto) {
    const { meter, coverage } = dto;
    const lines = [];
    if (coverage.degraded === true) {
      lines.push(
        coverage.warning ??
          'Entitlement coverage is temporarily unknown. Bookings continue; the coverage list below may be incomplete.',
      );
    } else if (typeof coverage.warning === 'string' && coverage.warning.length > 0) {
      lines.push(coverage.warning);
    }
    if (meter.degraded === true) {
      lines.push(
        'The counted-location total cannot be read right now. Bookings continue; the meter below may be incomplete.',
      );
    }
    if (lines.length === 0) return null;
    return el(
      'div',
      {
        role: 'alert',
        class: 'degraded-banner',
        'data-testid': 'degraded-banner',
      },
      ...lines.map((line) => el('p', { 'data-testid': 'degraded-banner-line', text: line })),
    );
  }

  function meterCountText(meter) {
    if (meter.degraded === true || meter.count === null) {
      return 'The number of counted locations cannot be read right now.';
    }
    return meter.count === 1
      ? '1 location is counted on this site.'
      : `${meter.count} locations are counted on this site.`;
  }

  function planAllowanceText(meter, coverage) {
    const allowance = coverage.allowedLocationIds.length;
    const allowanceNoun = `up to ${allowance} location${allowance === 1 ? '' : 's'}`;
    if (meter.degraded === true || meter.count === null) {
      return `Your plan manages ${allowanceNoun}; the total for this site cannot be read right now.`;
    }
    return `Your plan manages ${allowanceNoun}; this site has ${meter.count} counted.`;
  }

  function withinPlanNote(dto) {
    const { meter, coverage } = dto;
    const anyDegradedSignal =
      meter.degraded === true ||
      coverage.degraded === true ||
      (typeof coverage.warning === 'string' && coverage.warning.length > 0);
    if (anyDegradedSignal) return null; // never render silently healthy
    if (coverage.overLimit === true || meter.count === null) return null;
    return el('p', {
      'data-testid': 'within-plan-note',
      text: 'All counted locations are within your plan’s coverage.',
    });
  }

  function floorNote() {
    return el('p', {
      class: 'disclosure',
      'data-testid': 'floor-note',
      text:
        'No locations are counted yet. Under this app’s billing policy, a site with no counted locations is still treated as managing one location.',
    });
  }

  /**
   * Contract §7 upgrade entry point. Rendered only when the CTA condition
   * holds AND both identifiers were provided validly — identifiers are never
   * fabricated, so an unbuildable link degrades to the notice text alone.
   */
  function upgradeCta(coverage) {
    const show = coverage.overLimit === true || isTierRestricted;
    if (!show) return null;
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
      'data-testid': 'upgrade-cta',
      'aria-label': 'Upgrade to manage more locations (opens in a new tab)',
      text: 'Upgrade to manage more locations',
    });
  }

  function readyView(dto) {
    const { meter, coverage } = dto;
    const children = [];

    const banner = degradedBanner(dto);
    if (banner) children.push(banner);

    const meterSection = el(
      'section',
      { 'data-testid': 'meter-section', 'aria-label': 'Billable location meter' },
      el('h2', { text: 'Counted locations' }),
      el('p', { 'data-testid': 'meter-count', text: meterCountText(meter) }),
    );
    if (meter.degraded !== true && meter.count === 0) {
      meterSection.append(floorNote());
    }
    if (coverage.overLimit === true) {
      meterSection.append(
        el('p', { 'data-testid': 'plan-allowance', text: planAllowanceText(meter, coverage) }),
      );
    }
    const withinPlan = withinPlanNote(dto);
    if (withinPlan) meterSection.append(withinPlan);
    children.push(meterSection);

    const coverageSection = el(
      'section',
      { 'data-testid': 'coverage-section', 'aria-label': 'Covered locations' },
      el('h2', { text: 'Covered locations' }),
    );
    const list = el('ol', { 'data-testid': 'covered-location-list' });
    for (const id of coverage.allowedLocationIds) {
      list.append(el('li', { 'data-testid': 'covered-location-item', text: id }));
    }
    coverageSection.append(list);
    if (coverage.allowedLocationIds.length === 0 && coverage.degraded !== true) {
      coverageSection.append(
        el('p', {
          'data-testid': 'coverage-empty',
          text: 'No locations are currently covered.',
        }),
      );
    }
    coverageSection.append(
      el('p', { class: 'disclosure', 'data-testid': 'ordering-note', text: STABLE_ORDERING_NOTE }),
    );
    children.push(coverageSection);

    const cta = upgradeCta(coverage);
    if (coverage.overLimit === true) {
      children.push(
        el(
          'section',
          {
            'data-testid': 'over-limit-notice',
            'aria-label': 'Over your plan’s location limit',
          },
          el('h2', { text: 'Over your plan’s location limit' }),
          el('p', {
            'data-testid': 'over-limit-explanation',
            text:
              'Locations beyond the plan’s managed set are not controlled by this app’s rules. Their settings are preserved — nothing was deleted — and upgrading adds them back to coverage.',
          }),
          cta,
        ),
      );
    } else if (isTierRestricted) {
      children.push(
        el(
          'section',
          {
            'data-testid': 'tier-restricted-notice',
            'aria-label': 'Plan limits location management',
          },
          el('h2', { text: 'Your plan limits location management' }),
          el('p', {
            'data-testid': 'tier-restricted-explanation',
            text:
              'This plan restricts how many locations this app can manage. Upgrading increases coverage; your settings are kept either way.',
          }),
          cta,
        ),
      );
    }

    children.push(
      el('p', { class: 'disclosure', 'data-testid': 'counting-disclosure', text: COUNTING_DISCLOSURE }),
    );
    return children;
  }

  function retryButton() {
    return el(
      'button',
      {
        type: 'button',
        'data-testid': 'retry-load',
        title: 'Loads the usage information again.',
        onClick: () => void load(),
      },
      'Try again',
    );
  }

  function render() {
    const fragments = [];
    switch (view.status) {
      case 'loading':
        fragments.push(
          el('p', {
            role: 'status',
            'aria-live': 'polite',
            'data-testid': 'meter-loading',
            text: 'Loading usage…',
          }),
        );
        break;
      case 'na':
        fragments.push(
          el(
            'div',
            { 'data-testid': 'meter-na' },
            el('p', {
              text:
                'No usage information is available yet. Once the app finishes connecting to your Wix Bookings data, the counted locations appear here.',
            }),
            retryButton(),
          ),
        );
        break;
      case 'unavailable':
        fragments.push(
          el(
            'div',
            { role: 'alert', 'data-testid': 'load-error' },
            el('p', { 'data-testid': 'load-error-message', text: view.errorMessage ?? '' }),
            retryButton(),
          ),
        );
        break;
      case 'ready':
        fragments.push(...readyView(view.dto));
        break;
      default:
        break;
    }
    dynamic.replaceChildren(...fragments);
  }

  void load();

  return {
    root,
    /** Host-facing refresh seam (e.g. dashboard focus); same guarded path as the retry button. */
    reload() {
      void load();
    },
    destroy() {
      destroyed = true;
    },
  };
}
