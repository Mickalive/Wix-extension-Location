/**
 * locationsUsagePage — billable-location meter rendering (DASH-C4-1a).
 *
 * Proves the Blueprint §1 pages/LocationsUsage surface against the PINNED
 * cross-lane GET /meter DTO (fixture-tested until INT-C4-1 lands; identical
 * DTO-pinning pattern to the cycle-3 mutation-lifecycle tests):
 *   - pinned-DTO rendering incl. count:null degraded state;
 *   - over-limit state with plan allowance + stable-ordering note;
 *   - floor note (computed 0 => treated as 1, Contract §7);
 *   - persistent degraded-warning banner (fail-open posture: never silently
 *     healthy) and suppression of the positive "within plan" note;
 *   - upgrade CTA with the EXACT buildUpgradeUrl contract URL, opened in a
 *     NEW tab, shown when overLimit or tier-restricted — and never fabricated
 *     when identifiers are missing/invalid;
 *   - loading / error / n-a(404) states with a working retry affordance;
 *   - accessible markup consistent with the existing page kit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLocationsUsagePage } from '../../src/ui/pages/locationsUsagePage.js';
import { BridgeError } from '../../src/ui/services/bridge.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, maybeByTestId, allByTestId } from './helpers/dom.js';
import { auditLabels, assertKeyboardOperable } from './helpers/a11y.js';

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Pinned DTO fixture (docs/NEXT_CYCLE.json cross_lane_compatibility). */
function pinnedDto(overrides = {}) {
  const { meterPatch, coveragePatch, ...rest } = overrides;
  return {
    meter: { count: 3, degraded: false, ...(meterPatch ?? {}) },
    coverage: {
      allowedLocationIds: ['loc-zulu', 'loc-alpha', 'loc-mike'],
      overLimit: false,
      degraded: false,
      warning: null,
      ...(coveragePatch ?? {}),
    },
    ...rest,
  };
}

/**
 * Harness: renders the page against a scripted fake bridge. `responses` is a
 * queue of DTOs/null/errors consumed per load (initial load + retries).
 */
function setup({ responses = [], upgrade, isTierRestricted } = {}) {
  const doc = createDocument();
  const script = [...responses];
  const calls = { getEntitlementMeter: 0 };
  const bridge = {
    async getEntitlementMeter() {
      calls.getEntitlementMeter += 1;
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next === undefined ? null : next;
    },
  };
  const page = renderLocationsUsagePage({
    document: doc,
    bridge,
    upgrade,
    isTierRestricted,
  });
  doc.body.appendChild(page.root);
  return { doc, page, calls };
}

// ------------------------------------------------------- healthy rendering

test('loading state renders first, then the healthy pinned-DTO meter', async () => {
  const { doc } = setup({ responses: [pinnedDto()] });
  assert.ok(byTestId(doc.body, 'meter-loading'), 'loading region visible synchronously');
  await flush();

  assert.equal(byTestId(doc.body, 'meter-count').textContent, '3 locations are counted on this site.');
  assert.equal(maybeByTestId(doc.body, 'degraded-banner'), null, 'healthy reading shows no warning banner');
  assert.equal(maybeByTestId(doc.body, 'plan-allowance'), null, 'no allowance line when not over limit');
  assert.equal(maybeByTestId(doc.body, 'upgrade-cta'), null, 'no CTA when not over limit');
});

test('covered locations render in the DTO order verbatim (stable ordering never reordered client-side)', async () => {
  const { doc } = setup({ responses: [pinnedDto()] });
  await flush();
  assert.deepEqual(
    allByTestId(doc.body, 'covered-location-item').map((n) => n.textContent),
    ['loc-zulu', 'loc-alpha', 'loc-mike'],
  );
  assert.match(byTestId(doc.body, 'ordering-note').textContent, /default location first, then alphabetical/);
});

test('singular count renders honest singular copy', async () => {
  const { doc } = setup({ responses: [pinnedDto({ meterPatch: { count: 1 } })] });
  await flush();
  assert.equal(byTestId(doc.body, 'meter-count').textContent, '1 location is counted on this site.');
});

test('within-plan note appears only on a fully healthy, non-over-limit reading', async () => {
  const { doc } = setup({ responses: [pinnedDto()] });
  await flush();
  assert.match(byTestId(doc.body, 'within-plan-note').textContent, /within your plan/);
});

// ------------------------------------------------------------- floor note

test('floor note appears exactly when the computed count is 0 (0 => treated as 1)', async () => {
  const zero = setup({ responses: [pinnedDto({ meterPatch: { count: 0 } })] });
  await flush();
  assert.match(byTestId(zero.doc.body, 'floor-note').textContent, /treated as managing one location/);

  const nonzero = setup({ responses: [pinnedDto({ meterPatch: { count: 2 } })] });
  await flush();
  assert.equal(maybeByTestId(nonzero.doc.body, 'floor-note'), null);
});

// ---------------------------------------------------------- degraded states

test('count:null degraded state renders an unknown-count line plus persistent banner', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: null, degraded: true },
        coveragePatch: { degraded: true, warning: 'Location listing unavailable — entitlement coverage temporarily unknown.' },
      }),
    ],
  });
  await flush();

  assert.match(
    byTestId(doc.body, 'meter-count').textContent,
    /cannot be read right now/,
  );
  assert.equal(maybeByTestId(doc.body, 'floor-note'), null, 'no floor note for an unreadable count');
  const banner = byTestId(doc.body, 'degraded-banner');
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(banner.textContent, /Location listing unavailable/);
  assert.equal(maybeByTestId(doc.body, 'within-plan-note'), null, 'never silently healthy while degraded');
});

test('a non-null coverage.warning surfaces verbatim in the banner even with healthy flags', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        coveragePatch: { warning: 'Paid subscription recognized with an unmapped plan identifier.' },
      }),
    ],
  });
  await flush();
  const banner = byTestId(doc.body, 'degraded-banner');
  assert.match(banner.textContent, /Paid subscription recognized with an unmapped plan identifier\./);
  assert.equal(maybeByTestId(doc.body, 'within-plan-note'), null);
});

test('banner persists across reloads while degradation persists', async () => {
  const degraded = pinnedDto({
    meterPatch: { count: null, degraded: true },
    coveragePatch: { degraded: true, warning: 'Billing state unavailable — failing open (all managed locations covered).' },
  });
  const { doc, page } = setup({ responses: [degraded, degraded] });
  await flush();
  assert.ok(byTestId(doc.body, 'degraded-banner'));

  page.reload();
  await flush();
  assert.ok(byTestId(doc.body, 'degraded-banner'), 'still degraded after reload: banner still present');
});

test('banner clears only when the next reading is genuinely healthy (recovery, not silence)', async () => {
  const degraded = pinnedDto({
    meterPatch: { count: null, degraded: true },
    coveragePatch: { degraded: true, warning: 'Billing state unavailable — failing open (all managed locations covered).' },
  });
  const { doc, page } = setup({ responses: [degraded, pinnedDto()] });
  await flush();
  assert.ok(byTestId(doc.body, 'degraded-banner'));

  page.reload();
  await flush();
  assert.equal(maybeByTestId(doc.body, 'degraded-banner'), null);
  assert.ok(byTestId(doc.body, 'within-plan-note'));
});

// ------------------------------------------------------------- over-limit

test('over-limit state shows allowance, stable-ordering note, notice and the exact-contract CTA in a new tab', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: 5 },
        coveragePatch: {
          allowedLocationIds: ['loc-default-1', 'loc-a', 'loc-b', 'loc-c'],
          overLimit: true,
        },
      }),
    ],
    upgrade: { appId: 'app-under-test', instanceId: 'instance-under-test' },
  });
  await flush();

  assert.equal(
    byTestId(doc.body, 'plan-allowance').textContent,
    'Your plan manages up to 4 locations; this site has 5 counted.',
  );
  assert.ok(byTestId(doc.body, 'over-limit-notice'), 'over-limit restriction visible');
  assert.match(byTestId(doc.body, 'over-limit-explanation').textContent, /nothing was deleted/i);
  assert.match(byTestId(doc.body, 'ordering-note').textContent, /default location first, then alphabetical/);

  const cta = byTestId(doc.body, 'upgrade-cta');
  // Exact contracted URL shape (Contract §7): no encoding, no extra params.
  assert.equal(cta.getAttribute('href'), 'https://www.wix.com/apps/upgrade/app-under-test?appInstanceId=instance-under-test');
  assert.equal(cta.getAttribute('target'), '_blank', 'upgrade opens in a NEW tab');
  assert.equal(cta.getAttribute('rel'), 'noopener noreferrer');
});

test('over-limit with an unreadable count still shows the allowance and the CTA', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: null, degraded: true },
        coveragePatch: { allowedLocationIds: ['loc-only'], overLimit: true },
      }),
    ],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  await flush();
  assert.equal(
    byTestId(doc.body, 'plan-allowance').textContent,
    'Your plan manages up to 1 location; the total for this site cannot be read right now.',
  );
  assert.ok(byTestId(doc.body, 'upgrade-cta'));
});

test('CTA is absent when neither over-limit nor tier-restricted', async () => {
  const { doc } = setup({
    responses: [pinnedDto()],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  await flush();
  assert.equal(maybeByTestId(doc.body, 'upgrade-cta'), null);
  assert.equal(maybeByTestId(doc.body, 'over-limit-notice'), null);
  assert.equal(maybeByTestId(doc.body, 'tier-restricted-notice'), null);
});

test('tier-restricted option shows the CTA even without over-limit coverage', async () => {
  const { doc } = setup({
    responses: [pinnedDto()],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
    isTierRestricted: true,
  });
  await flush();
  assert.ok(byTestId(doc.body, 'tier-restricted-notice'));
  const cta = byTestId(doc.body, 'upgrade-cta');
  assert.equal(cta.getAttribute('href'), 'https://www.wix.com/apps/upgrade/app-x?appInstanceId=inst-y');
  assert.equal(cta.getAttribute('target'), '_blank');
});

test('identifiers are never fabricated: over-limit notice persists without a link when they are missing', async () => {
  for (const upgrade of [undefined, {}, { appId: 'only-app' }, { appId: 'a b', instanceId: 'i' }]) {
    const { doc } = setup({
      responses: [pinnedDto({ coveragePatch: { overLimit: true } })],
      upgrade,
    });
    await flush();
    assert.ok(byTestId(doc.body, 'over-limit-notice'), 'restriction stays visible');
    assert.equal(maybeByTestId(doc.body, 'upgrade-cta'), null, 'no link without valid identifiers');
  }
});

// ------------------------------------------------------ load-state handling

test('404 maps to the n/a state with a retry that recovers', async () => {
  const { doc, calls } = setup({ responses: [null, pinnedDto()] });
  await flush();
  assert.ok(byTestId(doc.body, 'meter-na'), 'n/a state rendered for documented 404 semantics');

  byTestId(doc.body, 'retry-load').click();
  await flush();
  assert.equal(byTestId(doc.body, 'meter-count').textContent, '3 locations are counted on this site.');
  assert.equal(calls.getEntitlementMeter, 2);
});

test('transport failure renders a typed error alert and retry succeeds afterwards', async () => {
  const { doc } = setup({
    // The real bridge wraps transport faults into typed BridgeErrors before
    // the page ever sees them; the fake reproduces that contract.
    responses: [new BridgeError('TRANSPORT_FAILURE', 'no response arrived'), pinnedDto()],
  });
  await flush();
  const errorRegion = byTestId(doc.body, 'load-error');
  assert.equal(errorRegion.getAttribute('role'), 'alert');
  assert.match(byTestId(doc.body, 'load-error-message').textContent, /network problem/);

  byTestId(doc.body, 'retry-load').click();
  await flush();
  assert.ok(byTestId(doc.body, 'meter-section'));
  assert.equal(maybeByTestId(doc.body, 'load-error'), null);
});

test('missing bridge renders the unavailable state instead of crashing', async () => {
  const doc = createDocument();
  const page = renderLocationsUsagePage({ document: doc, bridge: null });
  doc.body.appendChild(page.root);
  await flush();
  assert.match(byTestId(doc.body, 'load-error-message').textContent, /not connected yet/);
  page.destroy();
});

// ----------------------------------------------------------- accessibility

test('accessibility: every control named, keyboard operable, live regions correct', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: 5 },
        coveragePatch: { allowedLocationIds: ['loc-1'], overLimit: true },
      }),
    ],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  await flush();
  assert.deepEqual(auditLabels(doc.body), []);
  assert.equal(assertKeyboardOperable(doc.body, doc), true);
});

test('accessibility: error state controls are named and keyboard operable', async () => {
  const { doc } = setup({ responses: [new Error('boom')] });
  await flush();
  assert.deepEqual(auditLabels(doc.body), []);
  assert.equal(assertKeyboardOperable(doc.body, doc), true);
});
