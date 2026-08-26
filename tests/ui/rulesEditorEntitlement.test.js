/**
 * rulesEditorPage — management-side entitlement restriction (DASH-C5-1;
 * Contract §7 "restrict rule management/enforcement coverage to the plan
 * allowance"; Blueprint §4 flow 5).
 *
 * Fixture-tested against the PINNED cross-lane GET /meter DTO v1 (identically
 * pinned in docs/NEXT_CYCLE.json cross_lane_compatibility, INT-C4-1c and
 * DASH-C4-1a — consumed verbatim, no DTO changes this cycle):
 *
 *   { meter:    { count: number|null, degraded: boolean },
 *     coverage: { allowedLocationIds: string[], overLimit: boolean,
 *                 degraded: boolean, warning: string|null } }
 *
 * Proven here:
 *   - uncovered-location restriction rendering (badge + disabled NEW-rule
 *     controls) with the stable-ordering note ("default location first, then
 *     alphabetical");
 *   - existing-config preservation for uncovered locations (values still
 *     rendered read-only, NO deletion path on valid rows, draft never
 *     rewritten) plus the anti-trap corollary (rows/limits currently
 *     contributing a validation issue stay correctable so restriction can
 *     never brick the editor);
 *   - upgrade CTA visibility exactly on overLimit (exact buildUpgradeUrl
 *     contract URL, NEW TAB), never fabricated without identifiers;
 *   - degraded banner persistence inside the editor (meter.degraded ||
 *     coverage.degraded) with fail-open editing; degraded COVERAGE restricts
 *     nobody (C5 alignment with enforcement);
 *   - 404/null and typed bridge failures degrade to today's unrestricted
 *     editor behind non-blocking notices — never a crash;
 *   - accessible markup consistent with the page kit (roles, labels,
 *     keyboard operability);
 *   - bridge reuse only: the page talks to the meter exclusively through
 *     getEntitlementMeter(), with load dedupe and destroy-safety.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRulesEditorPage } from '../../src/ui/pages/rulesEditorPage.js';
import { createEditorStore } from '../../src/ui/state/editorStore.js';
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
    meter: { count: 2, degraded: false, ...(meterPatch ?? {}) },
    coverage: {
      allowedLocationIds: ['loc-default', 'loc-zulu'],
      overLimit: false,
      degraded: false,
      warning: null,
      ...(coveragePatch ?? {}),
    },
    ...rest,
  };
}

const TWO_LOCATIONS = [
  { id: 'loc-default', label: 'Default site' },
  { id: 'loc-zulu', label: 'Uptown' },
];
const ONE_SERVICE = [{ id: 'svc-1', label: 'Consultation' }];

/**
 * Harness: renders the editor against a scripted fake meter bridge.
 * `responses` is consumed per load (the initial background load consumes the
 * first entry synchronously at construction).
 */
function setup({ responses = [], upgrade, locations = TWO_LOCATIONS, services = ONE_SERVICE, savedRuleSet = null } = {}) {
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
  const store = createEditorStore({ savedRuleSet, locations, services });
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge,
    locations,
    services,
    upgrade,
  });
  doc.body.appendChild(page.root);
  return { doc, store, page, calls };
}

// ------------------------------------------------- idle / back-compat states

test('no bridge: today\'s unrestricted editor, zero entitlement regions (baseline compatibility)', async () => {
  const doc = createDocument();
  const store = createEditorStore({ savedRuleSet: null, locations: TWO_LOCATIONS, services: ONE_SERVICE });
  const page = renderRulesEditorPage({ store, document: doc, bridge: null, locations: TWO_LOCATIONS, services: ONE_SERVICE });
  doc.body.appendChild(page.root);
  await flush();

  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-default'), null);
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-zulu'), null);
  assert.equal(maybeByTestId(doc.body, 'editor-degraded-banner'), null);
  assert.equal(maybeByTestId(doc.body, 'editor-over-limit-section'), null);
  assert.equal(maybeByTestId(doc.body, 'meter-na-notice'), null);
  assert.equal(maybeByTestId(doc.body, 'meter-error-notice'), null);
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
  page.destroy();
});

test('legacy bridge without getEntitlementMeter stays silently idle (no invented entitlement state)', async () => {
  const doc = createDocument();
  const store = createEditorStore({ savedRuleSet: null, locations: TWO_LOCATIONS, services: ONE_SERVICE });
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge: { async saveRuleSet(draft) { return draft; } },
    locations: TWO_LOCATIONS,
    services: ONE_SERVICE,
  });
  doc.body.appendChild(page.root);
  await flush();

  assert.equal(maybeByTestId(doc.body, 'meter-na-notice'), null, 'no notice without any meter source');
  assert.equal(maybeByTestId(doc.body, 'meter-error-notice'), null);
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
  page.destroy();
});

// ------------------------------------------------------- healthy coverage

test('fully covered site: no badges, no locks, no notices; meter fetched exactly once through the bridge method', async () => {
  const { doc, calls } = setup({ responses: [pinnedDto()] });
  await flush();

  assert.equal(calls.getEntitlementMeter, 1);
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-default'), null);
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-zulu'), null);
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, false);
  assert.equal(maybeByTestId(doc.body, 'editor-degraded-banner'), null);
  assert.equal(maybeByTestId(doc.body, 'editor-over-limit-section'), null);
  assert.equal(maybeByTestId(doc.body, 'upgrade-cta'), null);
  assert.equal(maybeByTestId(doc.body, 'editor-upgrade-cta'), null);
});

// ------------------------------------------- uncovered-location restriction

test('uncovered location is badged and its NEW-rule controls are disabled; covered location untouched', async () => {
  const { doc } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
  });
  await flush();

  assert.ok(byTestId(doc.body, 'coverage-badge-loc-zulu'), 'restriction badge visible');
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-default'), null);

  // Every weekday's add-window control is locked for the uncovered location…
  for (const weekday of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
    const add = byTestId(doc.body, `add-window-location-loc-zulu-${weekday}`);
    assert.equal(add.disabled, true, `add-window locked for uncovered location on ${weekday}`);
    assert.match(add.getAttribute('title') ?? '', /your plan does not manage it/i);
  }
  // …while the covered location and all service scopes stay editable.
  assert.equal(byTestId(doc.body, 'add-window-location-loc-default-MON').disabled, false);
  assert.equal(byTestId(doc.body, 'add-window-service-svc-1-MON').disabled, false);

  // Per-location cap input locks too; DAY/SERVICE caps are unaffected.
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, true);
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-default').disabled, false);
  assert.equal(byTestId(doc.body, 'limit-DAY').disabled, false);
  assert.equal(byTestId(doc.body, 'limit-SERVICE-svc-1').disabled, false);
});

test('stable-ordering note renders verbatim under the restriction badge', async () => {
  const { doc } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
  });
  await flush();
  const note = byTestId(doc.body, 'coverage-note-loc-zulu');
  assert.match(note.textContent, /default location first, then alphabetical/);
  assert.match(note.textContent, /nothing is deleted/);
  assert.match(note.textContent, /not controlled by this app’s rules/);
});

test('window inputs of an uncovered location render read-only but keep their values', async () => {
  const saved = {
    locationWindows: { 'loc-zulu': { MON: [{ start: '09:00', end: '12:00' }] } },
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
  const { doc, store } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
    savedRuleSet: saved,
  });
  await flush();

  const start = byTestId(doc.body, 'window-start-location-loc-zulu-MON-0');
  const end = byTestId(doc.body, 'window-end-location-loc-zulu-MON-0');
  assert.equal(start.disabled, true, 'existing row input locked');
  assert.equal(end.disabled, true);
  assert.equal(start.value, '09:00', 'value still displayed');
  assert.equal(end.value, '12:00');

  // NO deletion path for valid existing configuration.
  const remove = byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0');
  assert.equal(remove.disabled, true, 'valid existing config has no deletion path');
  remove.click(); // swallowed at the DOM level — must be a no-op
  assert.deepEqual(
    store.getState().draft.locationWindows['loc-zulu'],
    saved.locationWindows['loc-zulu'],
    'locked Remove click changed nothing',
  );
});

test('existing-config preservation: draft is never rewritten and remove stays locked across re-renders', async () => {
  const saved = {
    locationWindows: { 'loc-zulu': { MON: [{ start: '09:00', end: '12:00' }] } },
    serviceWindows: {},
    exceptions: [],
    limits: [
      { limitId: 'limit-1', dimension: 'LOCATION', targetId: 'loc-zulu', maxCount: 4, includedStatuses: ['PENDING', 'CONFIRMED'] },
    ],
  };
  const { doc, store } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
    savedRuleSet: saved,
  });
  await flush();

  assert.equal(byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0').disabled, true);
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, true, 'existing per-location cap displayed read-only');
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').value, '4');

  // Interact elsewhere (covered location) to force re-renders…
  byTestId(doc.body, 'add-window-location-loc-default-MON').click();
  // …and prove the uncovered configuration was neither dropped nor unlocked.
  assert.deepEqual(store.getState().draft.locationWindows['loc-zulu'], saved.locationWindows['loc-zulu']);
  assert.deepEqual(store.getState().draft.limits, saved.limits, 'nothing silently dropped');
  assert.equal(byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0').disabled, true);
  assert.equal(byTestId(doc.body, 'window-start-location-loc-zulu-MON-0').value, '09:00');
});

test('anti-trap: an unfinished session row on a newly restricted location keeps its removal path', async () => {
  const { doc, store } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
  });
  // Add an incomplete row BEFORE the meter resolves (location still editable).
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'loc-zulu', weekday: 'MON' });
  await flush();

  // Restriction arrived: inputs lock, but the incomplete row must stay removable.
  assert.equal(byTestId(doc.body, 'window-start-location-loc-zulu-MON-0').disabled, true);
  const remove = byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0');
  assert.equal(remove.disabled, false, 'unfinished edit keeps its escape hatch');
  remove.click();
  // Store semantics: REMOVE_WEEK_WINDOW splices the row, leaving an empty
  // (harmless, op-less) weekday bucket behind.
  assert.deepEqual(store.getState().draft.locationWindows['loc-zulu'].MON, [], 'row removed via explicit click');
  assert.deepEqual(store.getState().issues, [], 'no issue can block review anymore');
  assert.equal(byTestId(doc.body, 'review-changes').disabled, false, 'review unblocked');
});

test('anti-trap: bucket-level overlap issues unlock every row in that bucket; valid remainder re-locks', async () => {
  const { doc, store } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
  });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'loc-zulu', weekday: 'MON' });
  store.dispatch({ type: 'PATCH_WEEK_WINDOW', scopeType: 'location', scopeId: 'loc-zulu', weekday: 'MON', index: 0, patch: { start: '09:00', end: '12:00' } });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'loc-zulu', weekday: 'MON' });
  store.dispatch({ type: 'PATCH_WEEK_WINDOW', scopeType: 'location', scopeId: 'loc-zulu', weekday: 'MON', index: 1, patch: { start: '10:00', end: '13:00' } });
  await flush();

  // Overlap marks the whole bucket: both rows stay removable despite restriction.
  assert.ok(store.getState().issues.some((issue) => issue.code === 'WINDOW_OVERLAP'));
  assert.equal(byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0').disabled, false);
  assert.equal(byTestId(doc.body, 'window-remove-location-loc-zulu-MON-1').disabled, false);

  byTestId(doc.body, 'window-remove-location-loc-zulu-MON-1').click();
  await flush();
  // Remaining row is valid existing-style configuration again → deletion path closes.
  assert.deepEqual(store.getState().issues, []);
  assert.equal(byTestId(doc.body, 'window-remove-location-loc-zulu-MON-0').disabled, true);
});

test('anti-trap: a limit that currently contributes a validation issue stays correctable', async () => {
  const { doc, store } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
  });
  // Non-canonical raw value kept verbatim by the store precisely so the
  // validator can flag it — set BEFORE the meter resolves.
  store.dispatch({ type: 'SET_LIMIT', dimension: 'LOCATION', targetId: 'loc-zulu', rawValue: 'abc' });
  await flush();

  assert.ok(store.getState().issues.some((issue) => issue.code === 'LIMIT_NOT_INTEGER'));
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, false, 'issue-carrying limit stays editable');
  store.dispatch({ type: 'SET_LIMIT', dimension: 'LOCATION', targetId: 'loc-zulu', rawValue: '' });
  assert.deepEqual(store.getState().issues, []);
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, true, 'clean state re-locks under restriction');
});

// ------------------------------------------------------------- over-limit CTA

test('overLimit surfaces the §7 CTA in the editor with the exact contract URL in a NEW tab', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: 5 },
        coveragePatch: { allowedLocationIds: ['loc-default'], overLimit: true },
      }),
    ],
    upgrade: { appId: 'app-under-test', instanceId: 'instance-under-test' },
  });
  await flush();

  assert.ok(byTestId(doc.body, 'editor-over-limit-section'));
  assert.match(byTestId(doc.body, 'editor-over-limit-explanation').textContent, /nothing was deleted/i);
  assert.match(byTestId(doc.body, 'editor-ordering-note').textContent, /default location first, then alphabetical/);

  const cta = byTestId(doc.body, 'editor-upgrade-cta');
  assert.equal(cta.getAttribute('href'), 'https://www.wix.com/apps/upgrade/app-under-test?appInstanceId=instance-under-test');
  assert.equal(cta.getAttribute('target'), '_blank', 'upgrade opens in a NEW tab');
  assert.equal(cta.getAttribute('rel'), 'noopener noreferrer');
  assert.match(cta.getAttribute('aria-label') ?? '', /opens in a new tab/);
});

test('overLimit without identifiers: section renders, CTA never fabricated', async () => {
  for (const upgrade of [undefined, {}, { appId: 'only-app' }, { appId: 'a b', instanceId: 'i' }]) {
    const { doc } = setup({
      responses: [
        pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'], overLimit: true } }),
      ],
      upgrade,
    });
    await flush();
    assert.ok(byTestId(doc.body, 'editor-over-limit-section'), 'restriction notice stays visible');
    assert.equal(maybeByTestId(doc.body, 'editor-upgrade-cta'), null, 'no link without valid identifiers');
  }
});

test('restriction without overLimit shows no CTA (membership, not the flag, drives locks)', async () => {
  const { doc } = setup({
    responses: [pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'] } })],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  await flush();
  assert.ok(byTestId(doc.body, 'coverage-badge-loc-zulu'), 'uncovered location still restricted');
  assert.equal(maybeByTestId(doc.body, 'editor-upgrade-cta'), null, 'CTA only on overLimit');
  assert.equal(maybeByTestId(doc.body, 'editor-over-limit-section'), null);
});

// ---------------------------------------------------------------- degraded

test('meter.degraded: persistent role=alert banner inside the editor; editing never bricked', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: null, degraded: true },
        coveragePatch: { allowedLocationIds: ['loc-default'] },
      }),
    ],
  });
  await flush();

  const banner = byTestId(doc.body, 'editor-degraded-banner');
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(banner.textContent, /counted-location total cannot be read right now/);
  // Fail-open posture: healthy-coverage editing continues normally.
  assert.equal(byTestId(doc.body, 'add-window-location-loc-default-MON').disabled, false);
});

test('degraded COVERAGE restricts nobody (C5 fail-open alignment with enforcement)', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        coveragePatch: {
          allowedLocationIds: ['loc-default'],
          degraded: true,
          warning: 'Billing state unavailable — failing open (all managed locations covered).',
        },
      }),
    ],
  });
  await flush();

  const banner = byTestId(doc.body, 'editor-degraded-banner');
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(banner.textContent, /failing open \(all managed locations covered\)/);
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-zulu'), null, 'no restriction off an unreliable list');
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, false);
});

test('degraded banner persists across store-driven re-renders while degradation persists', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: null, degraded: true },
        coveragePatch: { allowedLocationIds: ['loc-default'] },
      }),
    ],
  });
  await flush();
  assert.ok(byTestId(doc.body, 'editor-degraded-banner'));

  // Multiple edits → multiple re-renders → banner must survive every one.
  byTestId(doc.body, 'add-window-location-loc-default-MON').click();
  byTestId(doc.body, 'add-window-service-svc-1-TUE').click();
  byTestId(doc.body, 'add-exception').click();
  assert.ok(byTestId(doc.body, 'editor-degraded-banner'), 'still warned after re-renders');
});

test('healthy flags with a non-null warning surface it verbatim in the editor banner', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        coveragePatch: { warning: 'Paid subscription recognized with an unmapped plan identifier.' },
      }),
    ],
  });
  await flush();
  const banner = byTestId(doc.body, 'editor-degraded-banner');
  assert.match(banner.textContent, /Paid subscription recognized with an unmapped plan identifier\./);
});

// ------------------------------------------------------- 404/null + errors

test('404/null meter degrades to today\'s unrestricted editor behind a non-blocking info notice', async () => {
  const { doc } = setup({ responses: [null] });
  await flush();

  const notice = byTestId(doc.body, 'meter-na-notice');
  assert.equal(notice.getAttribute('role'), 'status', 'non-blocking by role');
  assert.equal(notice.getAttribute('aria-live'), 'polite');
  assert.match(notice.textContent, /not available from the app backend yet/);
  assert.match(notice.textContent, /stays fully editable/);
  assert.equal(maybeByTestId(doc.body, 'editor-degraded-banner'), null, 'never an alert for documented n/a');
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false, 'unrestricted editor');
  assert.equal(byTestId(doc.body, 'limit-LOCATION-loc-zulu').disabled, false);
});

test('typed transport failure degrades to unrestricted editing with honest wording (never a crash)', async () => {
  const { doc } = setup({
    responses: [new BridgeError('TRANSPORT_FAILURE', 'no response arrived')],
  });
  await flush();

  const notice = byTestId(doc.body, 'meter-error-notice');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.match(notice.textContent, /network problem/);
  assert.match(notice.textContent, /stays fully editable/);
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
});

test('drifted meter body (BAD_RESPONSE) surfaces typed wording, editor stays unrestricted', async () => {
  const { doc } = setup({
    responses: [new BridgeError('BAD_RESPONSE', 'GET /meter returned a 2xx body that does not match the pinned entitlement meter DTO.')],
  });
  await flush();
  assert.match(byTestId(doc.body, 'meter-error-notice').textContent, /unreadable response/);
  assert.equal(byTestId(doc.body, 'add-window-location-loc-zulu-MON').disabled, false);
});

// -------------------------------------------------------- lifecycle safety

test('destroy() before the meter resolves: late resolution is dropped without crashing or stale renders', async () => {
  let resolveMeter;
  const doc = createDocument();
  const store = createEditorStore({ savedRuleSet: null, locations: TWO_LOCATIONS, services: ONE_SERVICE });
  let calls = 0;
  const bridge = {
    getEntitlementMeter() {
      calls += 1;
      return new Promise((resolve) => { resolveMeter = resolve; });
    },
  };
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge,
    locations: TWO_LOCATIONS,
    services: ONE_SERVICE,
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  doc.body.appendChild(page.root);
  page.destroy();
  resolveMeter(pinnedDto({ coveragePatch: { allowedLocationIds: ['loc-default'], overLimit: true } }));
  await flush();

  assert.equal(calls, 1);
  assert.equal(maybeByTestId(doc.body, 'editor-over-limit-section'), null, 'no stale render after destroy');
  assert.equal(maybeByTestId(doc.body, 'coverage-badge-loc-zulu'), null);
});

test('reload seam: concurrent reloads collapse into one in-flight bridge call', async () => {
  let resolveMeter;
  let calls = 0;
  const doc = createDocument();
  const store = createEditorStore({ savedRuleSet: null, locations: TWO_LOCATIONS, services: ONE_SERVICE });
  const pending = [];
  const bridge = {
    getEntitlementMeter() {
      calls += 1;
      return new Promise((resolve) => { pending.push(resolve); });
    },
  };
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge,
    locations: TWO_LOCATIONS,
    services: ONE_SERVICE,
  });
  doc.body.appendChild(page.root);

  page.reload();
  page.reload();
  page.reload();
  assert.equal(calls, 1, 'in-flight guard dedupes concurrent reloads');

  pending[0](pinnedDto());
  await flush();
  assert.ok(byTestId(doc.body, 'limit-LOCATION-loc-zulu'));

  page.reload();
  assert.equal(calls, 2, 'a fresh reload after resolution issues a new call');
  pending[1](null);
  await flush();
  assert.ok(byTestId(doc.body, 'meter-na-notice'));
  page.destroy();
});

// ------------------------------------------------------------ accessibility

test('accessibility: composite restricted+over-limit+degraded state has named, keyboard-operable controls', async () => {
  const { doc } = setup({
    responses: [
      pinnedDto({
        meterPatch: { count: null, degraded: true },
        coveragePatch: { allowedLocationIds: ['loc-default'], overLimit: true },
      }),
    ],
    upgrade: { appId: 'app-x', instanceId: 'inst-y' },
  });
  await flush();

  assert.ok(byTestId(doc.body, 'editor-degraded-banner'));
  assert.ok(byTestId(doc.body, 'coverage-badge-loc-zulu'));
  assert.ok(byTestId(doc.body, 'editor-upgrade-cta'));
  assert.deepEqual(auditLabels(doc.body), [], 'every control named');
  assert.equal(assertKeyboardOperable(doc.body, doc), true, 'keyboard operable');
});

test('accessibility: n/a state controls remain named and keyboard operable', async () => {
  const { doc } = setup({ responses: [null] });
  await flush();
  assert.deepEqual(auditLabels(doc.body), []);
  assert.equal(assertKeyboardOperable(doc.body, doc), true);
});
