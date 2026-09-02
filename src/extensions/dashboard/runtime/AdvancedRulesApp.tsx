import { useEffect, useMemo, useRef, useState } from 'react';
import { dashboard } from '@wix/dashboard';
import { Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

import { createEditorStore, describeBridgeFailure } from '../../../ui/state/editorStore.js';
import { computeScheduleDiff, describeOps } from '../../../ui/diff/computeScheduleDiff.js';
import { pollMutationUntilTerminal } from '../../../ui/state/mutationPoller.js';
import {
  cloneDraft,
  createRuntimeServicesBridge,
  draftToRuleSetDto,
  ruleSetDtoToDraft,
} from '../../../ui/services/ruleSetRuntime.js';

const MODAL_ID = '99986b6c-de1f-4345-b063-fadf65fda76f';
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

type Store = ReturnType<typeof createEditorStore>;
type RuntimeRuleSet = Record<string, any>;
type Meter = {
  meter: { count: number | null; degraded: boolean };
  coverage: {
    allowedLocationIds: string[];
    overLimit: boolean;
    degraded: boolean;
    warning: string | null;
  };
};

const panelStyle: React.CSSProperties = {
  border: '1px solid #dfe5eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: '#fff',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 8,
};
const inputStyle: React.CSSProperties = {
  minHeight: 34,
  border: '1px solid #b7c2cc',
  borderRadius: 4,
  padding: '6px 8px',
};
const buttonStyle: React.CSSProperties = {
  minHeight: 34,
  border: '1px solid #116dff',
  borderRadius: 4,
  padding: '6px 12px',
  background: '#fff',
  cursor: 'pointer',
};
const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  color: '#fff',
  background: '#116dff',
};

function unionIds(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))].sort();
}

function stateMessage(state: any): string | null {
  if (state.saveStatus === 'pending') return 'Saving draft…';
  if (state.saveStatus === 'saved') return state.lastSaveMessage ?? 'Draft saved.';
  if (state.saveStatus === 'unavailable') return state.lastSaveMessage ?? 'Save unavailable.';
  if (state.applyStatus === 'pending') return 'Applying schedule changes…';
  if (state.applyStatus === 'applied') return state.lastApplyMessage ?? 'Schedule changes applied.';
  if (state.applyStatus === 'rolled_back') return state.lastApplyMessage ?? 'Apply failed and schedules were rolled back.';
  if (state.applyStatus === 'recovered') return state.lastApplyMessage ?? 'Interrupted apply recovered.';
  if (state.applyStatus === 'failed') return state.lastApplyMessage ?? 'Apply ended in an unresolved state.';
  if (state.applyStatus === 'unavailable') return state.lastApplyMessage ?? 'Apply unavailable.';
  if (state.recoverStatus === 'pending') return 'Recovering interrupted apply…';
  if (state.recoverStatus === 'unavailable') return state.lastRecoverMessage ?? 'Recovery unavailable.';
  if (state.recoverStatus === 'done') return state.lastRecoverMessage ?? 'Recovery completed.';
  return state.notice?.message ?? null;
}

function useStoreSnapshot(store: Store | null): any {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!store) return undefined;
    return store.subscribe(() => rerender((value) => value + 1));
  }, [store]);
  return store?.getState() ?? null;
}

function WindowsEditor({
  title,
  scopeType,
  scopeIds,
  store,
  draft,
}: {
  title: string;
  scopeType: 'location' | 'service';
  scopeIds: string[];
  store: Store;
  draft: any;
}) {
  const key = scopeType === 'location' ? 'locationWindows' : 'serviceWindows';
  return (
    <section style={panelStyle} aria-label={title}>
      <h2>{title}</h2>
      {scopeIds.length === 0 ? (
        <p>No {scopeType === 'location' ? 'covered locations' : 'configured services'} are available yet.</p>
      ) : null}
      {scopeIds.map((scopeId) => (
        <details key={scopeId} open>
          <summary style={{ fontWeight: 600, margin: '10px 0' }}>{scopeId}</summary>
          {WEEKDAYS.map((weekday) => {
            const rows = draft?.[key]?.[scopeId]?.[weekday] ?? [];
            return (
              <div key={weekday} style={{ marginBottom: 10 }}>
                <div style={rowStyle}>
                  <strong style={{ width: 44 }}>{weekday}</strong>
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType, scopeId, weekday })}
                  >
                    Add window
                  </button>
                </div>
                {rows.map((row: any, index: number) => (
                  <div key={`${weekday}-${index}`} style={{ ...rowStyle, paddingLeft: 52 }}>
                    <input
                      aria-label={`${scopeId} ${weekday} start ${index + 1}`}
                      style={inputStyle}
                      type="time"
                      value={row.start ?? ''}
                      onChange={(event) =>
                        store.dispatch({
                          type: 'PATCH_WEEK_WINDOW',
                          scopeType,
                          scopeId,
                          weekday,
                          index,
                          patch: { start: event.currentTarget.value },
                        })
                      }
                    />
                    <span>to</span>
                    <input
                      aria-label={`${scopeId} ${weekday} end ${index + 1}`}
                      style={inputStyle}
                      type="time"
                      value={row.end ?? ''}
                      onChange={(event) =>
                        store.dispatch({
                          type: 'PATCH_WEEK_WINDOW',
                          scopeType,
                          scopeId,
                          weekday,
                          index,
                          patch: { end: event.currentTarget.value },
                        })
                      }
                    />
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={() =>
                        store.dispatch({ type: 'REMOVE_WEEK_WINDOW', scopeType, scopeId, weekday, index })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </details>
      ))}
    </section>
  );
}

function ExceptionsEditor({ store, exceptions }: { store: Store; exceptions: any[] }) {
  return (
    <section style={panelStyle} aria-label="Dated exceptions">
      <div style={rowStyle}>
        <h2 style={{ marginRight: 8 }}>Dated exceptions</h2>
        <button type="button" style={buttonStyle} onClick={() => store.dispatch({ type: 'ADD_EXCEPTION' })}>
          Add exception
        </button>
      </div>
      {exceptions.map((entry: any) => (
        <div key={entry.exceptionId} style={{ ...panelStyle, background: '#f7f9fb' }}>
          <div style={rowStyle}>
            <input
              type="date"
              aria-label="Exception date"
              style={inputStyle}
              value={entry.date ?? ''}
              onChange={(event) =>
                store.dispatch({
                  type: 'UPDATE_EXCEPTION',
                  exceptionId: entry.exceptionId,
                  patch: { date: event.currentTarget.value },
                })
              }
            />
            <select
              aria-label="Exception type"
              style={inputStyle}
              value={entry.kind ?? 'CLOSED'}
              onChange={(event) =>
                store.dispatch({
                  type: 'UPDATE_EXCEPTION',
                  exceptionId: entry.exceptionId,
                  patch: { kind: event.currentTarget.value, windows: event.currentTarget.value === 'CLOSED' ? [] : entry.windows ?? [] },
                })
              }
            >
              <option value="CLOSED">Closed all day</option>
              <option value="OVERRIDE">Open override</option>
            </select>
            <input
              aria-label="Exception note"
              style={{ ...inputStyle, minWidth: 220 }}
              placeholder="Note (optional)"
              value={entry.note ?? ''}
              onChange={(event) =>
                store.dispatch({
                  type: 'UPDATE_EXCEPTION',
                  exceptionId: entry.exceptionId,
                  patch: { note: event.currentTarget.value },
                })
              }
            />
            <button
              type="button"
              style={buttonStyle}
              onClick={() => store.dispatch({ type: 'REMOVE_EXCEPTION', exceptionId: entry.exceptionId })}
            >
              Remove
            </button>
          </div>
          {entry.kind === 'OVERRIDE' ? (
            <div>
              {(entry.windows ?? []).map((window: any, index: number) => (
                <div key={index} style={rowStyle}>
                  <input
                    type="time"
                    style={inputStyle}
                    aria-label={`Exception window ${index + 1} start`}
                    value={window.start ?? ''}
                    onChange={(event) => {
                      const windows = (entry.windows ?? []).map((row: any) => ({ ...row }));
                      windows[index] = { ...windows[index], start: event.currentTarget.value };
                      store.dispatch({ type: 'UPDATE_EXCEPTION', exceptionId: entry.exceptionId, patch: { windows } });
                    }}
                  />
                  <span>to</span>
                  <input
                    type="time"
                    style={inputStyle}
                    aria-label={`Exception window ${index + 1} end`}
                    value={window.end ?? ''}
                    onChange={(event) => {
                      const windows = (entry.windows ?? []).map((row: any) => ({ ...row }));
                      windows[index] = { ...windows[index], end: event.currentTarget.value };
                      store.dispatch({ type: 'UPDATE_EXCEPTION', exceptionId: entry.exceptionId, patch: { windows } });
                    }}
                  />
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                      const windows = (entry.windows ?? []).filter((_: any, rowIndex: number) => rowIndex !== index);
                      store.dispatch({ type: 'UPDATE_EXCEPTION', exceptionId: entry.exceptionId, patch: { windows } });
                    }}
                  >
                    Remove window
                  </button>
                </div>
              ))}
              <button
                type="button"
                style={buttonStyle}
                onClick={() =>
                  store.dispatch({
                    type: 'UPDATE_EXCEPTION',
                    exceptionId: entry.exceptionId,
                    patch: { windows: [...(entry.windows ?? []), { start: '', end: '' }] },
                  })
                }
              >
                Add override window
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function LimitsEditor({
  store,
  draft,
  locationIds,
  serviceIds,
}: {
  store: Store;
  draft: any;
  locationIds: string[];
  serviceIds: string[];
}) {
  const valueFor = (dimension: string, targetId: string | null) =>
    draft?.limits?.find(
      (entry: any) => entry.dimension === dimension && (entry.targetId ?? null) === targetId,
    )?.maxCount ?? '';
  const input = (dimension: string, targetId: string | null, label: string) => (
    <label style={{ display: 'grid', gap: 4, minWidth: 240 }} key={`${dimension}-${targetId ?? 'all'}`}>
      <span>{label}</span>
      <input
        style={inputStyle}
        inputMode="numeric"
        value={String(valueFor(dimension, targetId))}
        placeholder="No limit"
        onChange={(event) =>
          store.dispatch({
            type: 'SET_LIMIT',
            dimension,
            targetId,
            rawValue: event.currentTarget.value,
          })
        }
      />
    </label>
  );
  return (
    <section style={panelStyle} aria-label="Booking limits">
      <h2>Booking limits</h2>
      <p>
        Limits are validated during booking. Concurrent checkouts can briefly race; reconciliation corrects counters afterwards.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {input('DAY', null, 'Maximum bookings per day')}
        {serviceIds.map((id) => input('SERVICE', id, `Service ${id}`))}
        {locationIds.map((id) => input('LOCATION', id, `Location ${id}`))}
      </div>
    </section>
  );
}

export default function AdvancedRulesApp() {
  const bridge = useMemo(() => createRuntimeServicesBridge(), []);
  const [store, setStore] = useState<Store | null>(null);
  const [previousRuleSet, setPreviousRuleSet] = useState<RuntimeRuleSet | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const previousRef = useRef<RuntimeRuleSet | null>(null);
  const snapshot = useStoreSnapshot(store);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([bridge.getActiveRuleSet(), bridge.getEntitlementMeter()])
      .then(([ruleSet, meterDto]) => {
        if (cancelled) return;
        const draft = ruleSetDtoToDraft(ruleSet);
        const locationIds = unionIds(Object.keys(draft.locationWindows ?? {}), meterDto?.coverage?.allowedLocationIds ?? []);
        const serviceIds = Object.keys(draft.serviceWindows ?? {}).sort();
        const nextStore = createEditorStore({
          savedRuleSet: cloneDraft(draft),
          draft: cloneDraft(draft),
          locations: locationIds.map((id) => ({ id, label: id })),
          services: serviceIds.map((id) => ({ id, label: id })),
        });
        previousRef.current = ruleSet;
        setPreviousRuleSet(ruleSet);
        setMeter(meterDto);
        setStore(nextStore);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(describeBridgeFailure(error, 'Loading rules'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const locationIds = useMemo(
    () =>
      unionIds(
        Object.keys(snapshot?.draft?.locationWindows ?? {}),
        meter?.coverage?.allowedLocationIds ?? [],
      ),
    [snapshot?.draft, meter],
  );
  const serviceIds = useMemo(
    () => Object.keys(snapshot?.draft?.serviceWindows ?? {}).sort(),
    [snapshot?.draft],
  );

  async function saveDraft() {
    if (!store) return;
    store.dispatch({ type: 'SAVE_START' });
    try {
      const currentDraft = cloneDraft(store.getState().draft);
      const dto = draftToRuleSetDto(currentDraft, previousRef.current);
      const savedDto = await bridge.saveRuleSet(dto);
      previousRef.current = savedDto;
      setPreviousRuleSet(savedDto);
      store.dispatch({ type: 'SAVE_SUCCESS', savedRuleSet: currentDraft });
    } catch (error) {
      store.dispatch({ type: 'SAVE_UNAVAILABLE', message: describeBridgeFailure(error, 'Save') });
    }
  }

  async function reviewChanges() {
    if (!store) return;
    store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
    const current = store.getState();
    if (!current.diffPreview.open) return;
    const diff = computeScheduleDiff(current.savedRuleSet, current.draft);
    try {
      const opened: any = dashboard.openModal({
        modalId: MODAL_ID,
        params: { hash: diff.hash, lines: describeOps(diff.ops), operationCount: diff.ops.length },
      });
      const result = await opened.modalClosed;
      if (result?.confirmed === true && result?.hash === diff.hash) {
        store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: diff.hash });
      } else {
        store.dispatch({ type: 'CLOSE_DIFF_PREVIEW' });
      }
    } catch (error) {
      store.dispatch({ type: 'CLOSE_DIFF_PREVIEW' });
      store.dispatch({ type: 'APPLY_UNAVAILABLE', message: describeBridgeFailure(error, 'Opening review') });
    }
  }

  async function applyChanges() {
    if (!store) return;
    const current = store.getState();
    if (!store.canApply() || !current.confirmedHash) {
      store.dispatch({
        type: 'APPLY_UNAVAILABLE',
        message: 'Apply is locked until you review and confirm the exact diff.',
      });
      return;
    }
    const draftAtApply = cloneDraft(current.draft);
    store.dispatch({ type: 'APPLY_START' });
    try {
      const response = await bridge.requestApply(current.confirmedHash);
      const planId = response?.summary?.planId;
      if (!planId) {
        store.dispatch({ type: 'APPLY_FAILED', message: 'The server did not return a mutation plan reference.' });
        return;
      }
      const outcome = await pollMutationUntilTerminal({
        getStatus: () => bridge.getMutationStatus(planId),
        onObservation: (projection: any) =>
          store.dispatch({
            type: 'MUTATION_TRACKED',
            planId: projection?.planId ?? planId,
            scope: projection?.scope ?? null,
            state: projection?.state ?? null,
          }),
      });
      switch (outcome.kind) {
        case 'APPLIED':
          store.dispatch({ type: 'APPLY_SUCCESS', savedRuleSet: draftAtApply, message: 'Schedule changes applied.' });
          break;
        case 'ROLLED_BACK':
          store.dispatch({ type: 'APPLY_ROLLED_BACK', message: 'Apply failed and Wix schedules were rolled back.' });
          break;
        case 'RECOVERED':
          store.dispatch({ type: 'APPLY_RECOVERED', message: 'An interrupted apply was recovered.' });
          break;
        default:
          store.dispatch({ type: 'APPLY_FAILED', message: 'The mutation did not reach a clean terminal state.' });
      }
    } catch (error) {
      store.dispatch({ type: 'APPLY_UNAVAILABLE', message: describeBridgeFailure(error, 'Apply') });
    }
  }

  async function recover() {
    if (!store) return;
    const scope = store.getState().lastMutation?.scope;
    if (!scope) return;
    store.dispatch({ type: 'RECOVER_START' });
    try {
      const summary = await bridge.recover(scope);
      store.dispatch({ type: 'RECOVER_RESULT', summary, message: summary ? null : 'Nothing was pending for recovery.' });
    } catch (error) {
      store.dispatch({ type: 'RECOVER_UNAVAILABLE', message: describeBridgeFailure(error, 'Recovery') });
    }
  }

  if (loading) {
    return <div role="status">Loading Advanced Booking Rules…</div>;
  }
  if (loadError || !store || !snapshot) {
    return <div role="alert">{loadError ?? 'The rules editor could not initialize.'}</div>;
  }

  const message = stateMessage(snapshot);
  const diff = computeScheduleDiff(snapshot.savedRuleSet, snapshot.draft);

  return (
    <WixDesignSystemProvider>
      <Page>
        <Page.Header
          title="Advanced Booking Rules"
          subtitle="Different hours, exceptions and booking caps by Wix Bookings location or service."
        />
        <Page.Content>
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '8px 0 32px' }}>
            <section style={{ ...panelStyle, background: '#f7f9fb' }}>
              <strong>Runtime status</strong>
              <p>
                {previousRuleSet ? `Loaded ruleset ${previousRuleSet.ruleSetId}, revision ${previousRuleSet.revision}.` : 'No ruleset exists yet; saving creates the first one.'}
              </p>
              {meter?.coverage?.warning ? <p role="alert">{meter.coverage.warning}</p> : null}
              {meter?.coverage?.degraded ? <p role="alert">Coverage is degraded; restrictions fail open.</p> : null}
            </section>

            {snapshot.issues?.length ? (
              <section style={{ ...panelStyle, borderColor: '#d64545' }} role="alert">
                <h2>Fix these validation issues</h2>
                <ul>
                  {snapshot.issues.map((issue: any, index: number) => (
                    <li key={`${issue.path ?? issue.field ?? 'issue'}-${index}`}>
                      {issue.path ?? issue.field ?? 'Rule'}: {issue.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <WindowsEditor
              title="Location opening windows"
              scopeType="location"
              scopeIds={locationIds}
              store={store}
              draft={snapshot.draft}
            />
            <WindowsEditor
              title="Service opening windows"
              scopeType="service"
              scopeIds={serviceIds}
              store={store}
              draft={snapshot.draft}
            />
            <ExceptionsEditor store={store} exceptions={snapshot.draft.exceptions ?? []} />
            <LimitsEditor store={store} draft={snapshot.draft} locationIds={locationIds} serviceIds={serviceIds} />

            <section style={panelStyle} aria-label="Changes and actions">
              <h2>Changes</h2>
              <p>{diff.ops.length === 0 ? 'No unsaved schedule changes.' : `${diff.ops.length} schedule change${diff.ops.length === 1 ? '' : 's'} in the current diff.`}</p>
              <div style={rowStyle}>
                <button type="button" style={buttonStyle} disabled={snapshot.saveStatus === 'pending'} onClick={() => void saveDraft()}>
                  {snapshot.saveStatus === 'pending' ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={snapshot.issues.length > 0 || diff.ops.length === 0}
                  onClick={() => void reviewChanges()}
                >
                  Review exact changes
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={!store.canApply() || snapshot.applyStatus === 'pending'}
                  onClick={() => void applyChanges()}
                >
                  {snapshot.applyStatus === 'pending' ? 'Applying…' : 'Apply to Wix schedules'}
                </button>
                {snapshot.lastMutation?.scope && !['applied', 'rolled_back', 'recovered', 'pending'].includes(snapshot.applyStatus) ? (
                  <button type="button" style={buttonStyle} onClick={() => void recover()}>
                    Recover interrupted apply
                  </button>
                ) : null}
              </div>
              {message ? <p role="status" aria-live="polite">{message}</p> : null}
              {store.canApply() ? <p role="status">Exact diff confirmed. Apply is unlocked for this hash only.</p> : null}
            </section>
          </div>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
}
