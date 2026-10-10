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
const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

type Store = ReturnType<typeof createEditorStore>;
type RuntimeRuleSet = Record<string, any>;
type CatalogItem = {
  id: string;
  label: string;
  type?: string | null;
  available?: boolean;
};
type Catalog = {
  services: CatalogItem[];
  locations: CatalogItem[];
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

function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeCatalogItem(value: any): CatalogItem | null {
  if (!value || typeof value.id !== 'string' || !value.id) return null;
  return {
    id: value.id,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : value.id,
    type: typeof value.type === 'string' ? value.type : null,
    available: value.available !== false,
  };
}

function normalizeCatalog(value: any): Catalog {
  return {
    services: (Array.isArray(value?.services) ? value.services : [])
      .map(normalizeCatalogItem)
      .filter((item: CatalogItem | null): item is CatalogItem => item !== null),
    locations: (Array.isArray(value?.locations) ? value.locations : [])
      .map(normalizeCatalogItem)
      .filter((item: CatalogItem | null): item is CatalogItem => item !== null),
  };
}

function mergeConfiguredItems(live: CatalogItem[], configuredIds: string[]): CatalogItem[] {
  const byId = new Map<string, CatalogItem>();
  for (const item of live) byId.set(item.id, { ...item, available: true });
  for (const id of configuredIds) {
    if (!byId.has(id)) {
      byId.set(id, { id, label: `${id} · no longer available in Wix`, available: false });
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function itemLabel(item: CatalogItem): string {
  const suffix = item.type ? ` · ${titleCase(item.type)}` : '';
  return `${item.label}${suffix}`;
}

function stateMessage(state: any): string | null {
  if (state.saveStatus === 'pending') return 'Saving draft…';
  if (state.saveStatus === 'unavailable') return state.lastSaveMessage ?? 'Draft could not be saved.';
  if (state.applyStatus === 'pending') return 'Activating booking rules…';
  if (state.applyStatus === 'applied') return state.lastApplyMessage ?? 'Booking rules activated.';
  if (state.applyStatus === 'rolled_back') return state.lastApplyMessage ?? 'Activation failed and Wix schedule changes were rolled back.';
  if (state.applyStatus === 'recovered') return state.lastApplyMessage ?? 'Interrupted activation recovered.';
  if (state.applyStatus === 'failed') return state.lastApplyMessage ?? 'Activation ended in an unresolved state.';
  if (state.applyStatus === 'unavailable') return state.lastApplyMessage ?? 'Activation unavailable.';
  if (state.recoverStatus === 'pending') return 'Recovering interrupted activation…';
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
  items,
  store,
  draft,
  emptyText,
}: {
  title: string;
  scopeType: 'location' | 'service';
  items: CatalogItem[];
  store: Store;
  draft: any;
  emptyText: string;
}) {
  const key = scopeType === 'location' ? 'locationWindows' : 'serviceWindows';
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isConfigured = (itemId: string) =>
    WEEKDAYS.some((weekday) => (draft?.[key]?.[itemId]?.[weekday] ?? []).length > 0);

  const clearSchedule = (itemId: string) => {
    for (const weekday of WEEKDAYS) {
      const rows = draft?.[key]?.[itemId]?.[weekday] ?? [];
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        store.dispatch({ type: 'REMOVE_WEEK_WINDOW', scopeType, scopeId: itemId, weekday, index });
      }
    }
  };

  return (
    <section style={{ ...panelStyle, padding: 20 }} aria-label={title}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={{ margin: '6px 0 0', color: '#576675' }}>
          {scopeType === 'service'
            ? 'Choose a service only when you want stricter booking hours than Wix already provides.'
            : 'Optional: apply booking hours to every service at a business location.'}
        </p>
      </div>

      {items.length === 0 ? <p style={{ color: '#576675' }}>{emptyText}</p> : null}

      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((item) => {
          const configured = isConfigured(item.id);
          const expanded = expandedId === item.id;
          return (
            <div
              key={item.id}
              style={{
                border: '1px solid #dfe5eb',
                borderRadius: 10,
                background: '#fff',
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                style={{
                  width: '100%',
                  border: 0,
                  background: '#fff',
                  padding: '16px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 16 }}>{item.label}</strong>
                  <span style={{ color: configured ? '#116dff' : '#576675', fontSize: 13 }}>
                    {configured ? 'Custom booking hours' : 'Uses Wix availability'}
                  </span>
                </span>
                <span style={{ color: '#116dff', fontWeight: 600 }}>{expanded ? 'Done' : 'Edit'}</span>
              </button>

              {expanded ? (
                <div style={{ borderTop: '1px solid #eef1f4', padding: '16px 18px 18px', background: '#fbfcfd' }}>
                  {item.available === false ? (
                    <p style={{ marginTop: 0 }}>
                      This item is no longer available in Wix. Remove its old rules or restore it in Wix before editing it.
                    </p>
                  ) : null}

                  <div
                    style={{
                      borderRadius: 8,
                      padding: '12px 14px',
                      background: configured ? '#eaf3ff' : '#f2f4f7',
                      marginBottom: 14,
                    }}
                  >
                    {configured ? (
                      <span>
                        <strong>Custom schedule is on.</strong> Only the hours listed below can be booked. A day with no hours is closed.
                      </span>
                    ) : (
                      <span>
                        <strong>No custom restriction.</strong> Wix Bookings currently decides availability for this {scopeType}.
                      </span>
                    )}
                  </div>

                  {configured ? (
                    <button
                      type="button"
                      style={{ ...buttonStyle, marginBottom: 14 }}
                      onClick={() => clearSchedule(item.id)}
                    >
                      Use Wix availability instead
                    </button>
                  ) : null}

                  <div style={{ display: 'grid', gap: 8 }}>
                    {WEEKDAYS.map((weekday) => {
                      const rows = draft?.[key]?.[item.id]?.[weekday] ?? [];
                      return (
                        <div
                          key={weekday}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '110px minmax(180px, 1fr) auto',
                            gap: 12,
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: weekday === 'SUN' ? 'none' : '1px solid #eef1f4',
                          }}
                        >
                          <strong>{WEEKDAY_LABELS[weekday]}</strong>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {rows.length === 0 ? (
                              <span style={{ color: '#687785' }}>{configured ? 'Closed' : 'No custom restriction'}</span>
                            ) : null}
                            {rows.map((row: any, index: number) => (
                              <div key={`${weekday}-${index}`} style={{ ...rowStyle, marginBottom: 0 }}>
                                <input
                                  aria-label={`${item.label} ${weekday} start ${index + 1}`}
                                  style={inputStyle}
                                  type="time"
                                  value={row.start ?? ''}
                                  disabled={item.available === false}
                                  onChange={(event) =>
                                    store.dispatch({
                                      type: 'PATCH_WEEK_WINDOW',
                                      scopeType,
                                      scopeId: item.id,
                                      weekday,
                                      index,
                                      patch: { start: event.currentTarget.value },
                                    })
                                  }
                                />
                                <span>to</span>
                                <input
                                  aria-label={`${item.label} ${weekday} end ${index + 1}`}
                                  style={inputStyle}
                                  type="time"
                                  value={row.end ?? ''}
                                  disabled={item.available === false}
                                  onChange={(event) =>
                                    store.dispatch({
                                      type: 'PATCH_WEEK_WINDOW',
                                      scopeType,
                                      scopeId: item.id,
                                      weekday,
                                      index,
                                      patch: { end: event.currentTarget.value },
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, borderColor: '#c7d1db', color: '#33424f' }}
                                  onClick={() =>
                                    store.dispatch({ type: 'REMOVE_WEEK_WINDOW', scopeType, scopeId: item.id, weekday, index })
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            style={buttonStyle}
                            disabled={item.available === false}
                            onClick={() => store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType, scopeId: item.id, weekday })}
                          >
                            Add hours
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExceptionsEditor({ store, exceptions }: { store: Store; exceptions: any[] }) {
  return (
    <section style={panelStyle} aria-label="Dated exceptions">
      <div style={rowStyle}>
        <h2 style={{ marginRight: 8 }}>Special dates</h2>
        <button type="button" style={buttonStyle} onClick={() => store.dispatch({ type: 'ADD_EXCEPTION' })}>
          Add exception
        </button>
      </div>
      {exceptions.length === 0 ? <p>No special dates configured.</p> : null}
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
                  patch: {
                    kind: event.currentTarget.value,
                    windows: event.currentTarget.value === 'CLOSED' ? [] : entry.windows ?? [],
                  },
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
  locations,
  services,
}: {
  store: Store;
  draft: any;
  locations: CatalogItem[];
  services: CatalogItem[];
}) {
  const valueFor = (dimension: string, targetId: string | null) =>
    draft?.limits?.find(
      (entry: any) => entry.dimension === dimension && (entry.targetId ?? null) === targetId,
    )?.maxCount ?? '';
  const input = (dimension: string, targetId: string | null, label: string, disabled = false) => (
    <label style={{ display: 'grid', gap: 4, minWidth: 240 }} key={`${dimension}-${targetId ?? 'all'}`}>
      <span>{label}</span>
      <input
        style={inputStyle}
        inputMode="numeric"
        value={String(valueFor(dimension, targetId))}
        placeholder="No limit"
        disabled={disabled}
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
      <p style={{ color: '#576675' }}>
        Optional: stop accepting bookings after a daily maximum is reached.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {input('DAY', null, 'Maximum bookings per day')}
        {services.map((item) => input('SERVICE', item.id, `${item.label}`, item.available === false))}
        {locations.map((item) => input('LOCATION', item.id, `${item.label}`, item.available === false))}
      </div>
    </section>
  );
}

export default function AdvancedRulesApp() {
  const bridge = useMemo(() => createRuntimeServicesBridge(), []);
  const [store, setStore] = useState<Store | null>(null);
  const [activeRuleSet, setActiveRuleSet] = useState<RuntimeRuleSet | null>(null);
  const [draftRuleSet, setDraftRuleSet] = useState<RuntimeRuleSet | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ services: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const draftRevisionRef = useRef<RuntimeRuleSet | null>(null);
  const lastSavedDraftRef = useRef<any>(ruleSetDtoToDraft(null));
  const snapshot = useStoreSnapshot(store);

  function buildStore(activeDto: RuntimeRuleSet | null, draft: any, liveCatalog: Catalog): Store {
    return createEditorStore({
      savedRuleSet: cloneDraft(ruleSetDtoToDraft(activeDto)),
      draft: cloneDraft(draft),
      locations: liveCatalog.locations.map((item) => ({ id: item.id, label: item.label })),
      services: liveCatalog.services.map((item) => ({ id: item.id, label: item.label })),
    });
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([bridge.getRuleSetState(), bridge.getCatalog()])
      .then(([ruleState, catalogDto]) => {
        if (cancelled) return;
        const liveCatalog = normalizeCatalog(catalogDto);
        const activeDto = ruleState?.activeRuleSet ?? null;
        const draftDto = ruleState?.draftRuleSet ?? activeDto;
        const initialDraft = ruleSetDtoToDraft(draftDto);

        draftRevisionRef.current = draftDto;
        lastSavedDraftRef.current = cloneDraft(initialDraft);
        setActiveRuleSet(activeDto);
        setDraftRuleSet(draftDto);
        setCatalog(liveCatalog);
        setStore(buildStore(activeDto, initialDraft, liveCatalog));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(describeBridgeFailure(error, 'Loading booking rules'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const locationItems = useMemo(
    () => mergeConfiguredItems(catalog.locations, Object.keys(snapshot?.draft?.locationWindows ?? {})),
    [catalog.locations, snapshot?.draft],
  );
  const serviceItems = useMemo(
    () => mergeConfiguredItems(catalog.services, Object.keys(snapshot?.draft?.serviceWindows ?? {})),
    [catalog.services, snapshot?.draft],
  );
  const activationDiff = useMemo(
    () => computeScheduleDiff(snapshot?.savedRuleSet ?? ruleSetDtoToDraft(null), snapshot?.draft ?? ruleSetDtoToDraft(null)),
    [snapshot?.savedRuleSet, snapshot?.draft],
  );
  const unsavedDraftDiff = useMemo(
    () => computeScheduleDiff(lastSavedDraftRef.current, snapshot?.draft ?? ruleSetDtoToDraft(null)),
    [snapshot?.draft, store],
  );
  const hasUnsavedDraft = unsavedDraftDiff.ops.length > 0;

  async function saveDraft() {
    if (!store || snapshot.issues.length > 0) return;
    store.dispatch({ type: 'SAVE_START' });
    setLocalMessage(null);
    try {
      const currentDraft = cloneDraft(store.getState().draft);
      const dto = draftToRuleSetDto(currentDraft, draftRevisionRef.current);
      const savedDto = await bridge.saveRuleSet(dto);
      draftRevisionRef.current = savedDto;
      lastSavedDraftRef.current = cloneDraft(currentDraft);
      setDraftRuleSet(savedDto);
      setStore(buildStore(activeRuleSet, currentDraft, catalog));
      setLocalMessage('Draft saved. These changes are not active until you activate the booking rules.');
    } catch (error) {
      store.dispatch({ type: 'SAVE_UNAVAILABLE', message: describeBridgeFailure(error, 'Save') });
    }
  }

  async function reviewChanges() {
    if (!store) return;
    if (hasUnsavedDraft) {
      setLocalMessage('Save the draft before reviewing it for activation.');
      return;
    }
    store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
    const current = store.getState();
    if (!current.diffPreview.open) return;
    const diff = computeScheduleDiff(current.savedRuleSet, current.draft);
    const diffLabels = {
      locations: Object.fromEntries(locationItems.map((item) => [item.id, itemLabel(item)])),
      services: Object.fromEntries(serviceItems.map((item) => [item.id, itemLabel(item)])),
    };
    try {
      const opened: any = dashboard.openModal({
        modalId: MODAL_ID,
        params: { hash: diff.hash, lines: describeOps(diff.ops, diffLabels), operationCount: diff.ops.length },
      });
      const result = await opened.modalClosed;
      if (result?.confirmed === true && result?.hash === diff.hash) {
        store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: diff.hash });
        setLocalMessage('Exact changes confirmed. You can now activate this ruleset.');
      } else {
        store.dispatch({ type: 'CLOSE_DIFF_PREVIEW' });
      }
    } catch (error) {
      store.dispatch({ type: 'CLOSE_DIFF_PREVIEW' });
      store.dispatch({ type: 'APPLY_UNAVAILABLE', message: describeBridgeFailure(error, 'Opening review') });
    }
  }

  async function reviewAndActivate() {
    if (!store || hasUnsavedDraft || activationDiff.ops.length === 0 || snapshot.issues.length > 0) return;
    const current = store.getState();
    const diff = computeScheduleDiff(current.savedRuleSet, current.draft);
    const diffLabels = {
      locations: Object.fromEntries(locationItems.map((item) => [item.id, item.label])),
      services: Object.fromEntries(serviceItems.map((item) => [item.id, item.label])),
    };
    try {
      const opened: any = dashboard.openModal({
        modalId: MODAL_ID,
        params: { hash: diff.hash, lines: describeOps(diff.ops, diffLabels), operationCount: diff.ops.length },
      });
      const result = await opened.modalClosed;
      if (result?.confirmed === true && result?.hash === diff.hash) {
        store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: diff.hash });
        setLocalMessage('Changes confirmed. Activating…');
        await applyChanges();
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
    if (hasUnsavedDraft) {
      store.dispatch({ type: 'APPLY_UNAVAILABLE', message: 'Save the draft before activating it.' });
      return;
    }
    if (!store.canApply() || !current.confirmedHash) {
      store.dispatch({
        type: 'APPLY_UNAVAILABLE',
        message: 'Activation is locked until you review and confirm the exact changes.',
      });
      return;
    }
    const draftAtApply = cloneDraft(current.draft);
    store.dispatch({ type: 'APPLY_START' });
    setLocalMessage(null);
    try {
      const response = await bridge.requestApply(current.confirmedHash);
      const planId = response?.summary?.planId;
      if (!planId) {
        store.dispatch({ type: 'APPLY_FAILED', message: 'The server did not return an activation plan reference.' });
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
          setActiveRuleSet(draftRevisionRef.current);
          lastSavedDraftRef.current = cloneDraft(draftAtApply);
          store.dispatch({ type: 'APPLY_SUCCESS', savedRuleSet: draftAtApply, message: 'Booking rules activated.' });
          break;
        case 'ROLLED_BACK':
          store.dispatch({ type: 'APPLY_ROLLED_BACK', message: 'Activation failed; any Wix schedule changes were rolled back.' });
          break;
        case 'RECOVERED':
          store.dispatch({ type: 'APPLY_RECOVERED', message: 'An interrupted activation was recovered.' });
          break;
        default:
          store.dispatch({ type: 'APPLY_FAILED', message: 'The activation did not reach a clean terminal state.' });
      }
    } catch (error) {
      store.dispatch({ type: 'APPLY_UNAVAILABLE', message: describeBridgeFailure(error, 'Activation') });
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

  const message = localMessage ?? stateMessage(snapshot);
  const savedButInactive = !hasUnsavedDraft && activationDiff.ops.length > 0;

  return (
    <WixDesignSystemProvider>
      <Page>
        <Page.Header
          title="Advanced Booking Rules"
          subtitle="Control when customers can book, without changing your existing Wix Bookings setup."
        />
        <Page.Content>
          <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 0 40px' }}>
            <section
              style={{
                ...panelStyle,
                padding: 22,
                background: '#f7fbff',
                borderColor: '#cfe2ff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ maxWidth: 680 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                    {activeRuleSet ? 'Your advanced rules are active' : 'Wix Bookings is currently in control'}
                  </div>
                  <p style={{ margin: 0, color: '#4f6070', lineHeight: 1.5 }}>
                    Start with a service below. Add a rule only where you need more control. If you leave a service untouched, Wix keeps handling its availability normally.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: '#fff', border: '1px solid #d9e2ea', borderRadius: 999, padding: '7px 11px', fontSize: 13 }}>
                    {catalog.services.length} service{catalog.services.length === 1 ? '' : 's'} connected
                  </span>
                  <span style={{ background: '#fff', border: '1px solid #d9e2ea', borderRadius: 999, padding: '7px 11px', fontSize: 13 }}>
                    {catalog.locations.length} location{catalog.locations.length === 1 ? '' : 's'} connected
                  </span>
                </div>
              </div>
              {draftRuleSet && savedButInactive ? (
                <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: '#fff7e6' }}>
                  You have saved changes that are not active yet.
                </div>
              ) : null}
            </section>

            {snapshot.issues?.length ? (
              <section style={{ ...panelStyle, borderColor: '#d64545', background: '#fff7f7' }} role="alert">
                <h2 style={{ marginTop: 0 }}>Fix these before continuing</h2>
                <ul style={{ marginBottom: 0 }}>
                  {snapshot.issues.map((issue: any, index: number) => (
                    <li key={`${issue.path ?? issue.field ?? 'issue'}-${index}`}>
                      {issue.path ?? issue.field ?? 'Rule'}: {issue.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <WindowsEditor
              title="Service booking hours"
              scopeType="service"
              items={serviceItems}
              store={store}
              draft={snapshot.draft}
              emptyText="No Wix Bookings services are available on this site."
            />

            <details style={panelStyle}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 17 }}>More controls</summary>
              <p style={{ color: '#576675' }}>Use these only when you need rules that apply across services or on specific dates.</p>

              <WindowsEditor
                title="Location-wide booking hours"
                scopeType="location"
                items={locationItems}
                store={store}
                draft={snapshot.draft}
                emptyText="No Wix business locations are available on this site."
              />
              <ExceptionsEditor store={store} exceptions={snapshot.draft.exceptions ?? []} />
              <LimitsEditor store={store} draft={snapshot.draft} locations={locationItems} services={serviceItems} />
            </details>

            <section
              style={{
                ...panelStyle,
                position: 'sticky',
                bottom: 12,
                boxShadow: '0 8px 28px rgba(30, 55, 80, 0.14)',
                borderColor: '#cfd9e3',
              }}
              aria-label="Save and activate"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: '0 0 4px' }}>
                    {hasUnsavedDraft
                      ? 'Save your changes'
                      : activationDiff.ops.length > 0
                        ? 'Ready to activate'
                        : activeRuleSet
                          ? 'Everything is up to date'
                          : 'No advanced rules yet'}
                  </h2>
                  <p style={{ margin: 0, color: '#576675' }}>
                    {hasUnsavedDraft
                      ? 'Saving creates a draft. Customer bookings do not change until you activate it.'
                      : activationDiff.ops.length > 0
                        ? 'Review the exact effect, then activate it in one step.'
                        : activeRuleSet
                          ? 'The active rules match what you see here.'
                          : 'Add custom hours or another rule above when you need them.'}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {hasUnsavedDraft ? (
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      disabled={snapshot.issues.length > 0 || snapshot.saveStatus === 'pending'}
                      onClick={() => void saveDraft()}
                    >
                      {snapshot.saveStatus === 'pending' ? 'Saving…' : 'Save changes'}
                    </button>
                  ) : null}

                  {!hasUnsavedDraft && activationDiff.ops.length > 0 ? (
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      disabled={snapshot.issues.length > 0 || snapshot.applyStatus === 'pending'}
                      onClick={() => void reviewAndActivate()}
                    >
                      {snapshot.applyStatus === 'pending' ? 'Activating…' : 'Review & activate'}
                    </button>
                  ) : null}

                  {snapshot.lastMutation?.scope && !['applied', 'rolled_back', 'recovered', 'pending'].includes(snapshot.applyStatus) ? (
                    <button type="button" style={buttonStyle} onClick={() => void recover()}>
                      Recover interrupted activation
                    </button>
                  ) : null}
                </div>
              </div>
              {message ? <p role="status" aria-live="polite" style={{ marginBottom: 0 }}>{message}</p> : null}
            </section>
          </div>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
}