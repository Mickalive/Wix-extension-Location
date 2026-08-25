/**
 * Editor store: a small deterministic state machine for the rules editor.
 *
 * Consent gating (Contract section 9.2), enforced at THREE independent layers:
 *   1. Reducer: OPEN_DIFF_PREVIEW is refused while validation issues exist;
 *      CONFIRM only lands when the modal is open, the rendered hash matches
 *      the current draft hash, and no issue is open.
 *   2. Page UI: "Review changes" is disabled with an explanatory title while
 *      issues exist; "Apply" is disabled until canApply() holds.
 *   3. Modal UI: even if a modal instance is somehow open while issues exist,
 *      its Confirm button renders disabled next to an in-modal warning listing
 *      the blocking issues.
 *
 * Every draft mutation invalidates any prior confirmation (stale-hash replay
 * is rejected by construction).
 *
 * Mutation lifecycle (DASH-C3-1; Blueprint §4 flow 3): after APPLY_START the
 * store tracks the server-side journal via MUTATION_TRACKED observations
 * ({planId, scope, state}) and records the polled TERMINAL outcome through
 * APPLY_SUCCESS / APPLY_ROLLED_BACK / APPLY_RECOVERED / APPLY_FAILED. One
 * confirmed consent covers exactly one apply attempt: every terminal outcome
 * clears the confirmation so a retry always requires fresh review + confirm.
 * Recovery is a separate explicit user action (RECOVER_* actions); nothing in
 * the store ever schedules or auto-triggers a destructive operation.
 */

import { computeScheduleDiff } from '../diff/computeScheduleDiff.js';
import { validateDraft } from '../validation/mirror.js';
import { isBridgeError } from '../services/bridge.js';

function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

export function emptyDraft() {
  return {
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
}

let exceptionCounter = 0;
function nextExceptionId() {
  exceptionCounter += 1;
  return `exc-${Date.now().toString(36)}-${exceptionCounter}`;
}

/**
 * @param {object} input
 * @param {object|null} input.savedRuleSet - last persisted rule set (or null)
 * @param {Array<{id:string,label:string}>} [input.locations]
 * @param {Array<{id:string,label:string}>} [input.services]
 */
export function createEditorStore(input = {}) {
  const savedRuleSet = input.savedRuleSet ?? null;
  const locations = input.locations ?? [];
  const services = input.services ?? [];
  const initialDraft = input.draft
    ? cloneDraft(input.draft)
    : cloneDraft(savedRuleSet ?? emptyDraft());

  let state = reduce(
    {
      savedRuleSet,
      draft: initialDraft,
      locations,
      services,
      issues: [],
      diffPreview: { open: false, renderedHash: null },
      confirmedHash: null,
      notice: null,
      saveStatus: 'idle', // idle | pending | unavailable | saved
      applyStatus: 'idle', // idle | pending | unavailable | applied | rolled_back | recovered | failed
      lastSaveMessage: null,
      lastApplyMessage: null,
      // Mutation-lifecycle tracking (flow 3): the journal record this editor
      // is following, plus the explicit recovery session state.
      lastMutation: null, // { planId, scope, state } | null
      recoverStatus: 'idle', // idle | pending | unavailable | done
      lastRecoverySummary: null, // RecoverySummary | null (null + done => nothing was pending)
      lastRecoverMessage: null,
    },
    { type: '_INIT' },
  );

  const listeners = new Set();
  function emit() {
    for (const listener of [...listeners]) listener(state);
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispatch(action) {
      const next = reduce(state, action);
      if (next !== state) {
        state = next;
        emit();
      }
    },

    // ------------------------------------------------------------- selectors

    /** Memoized diff of saved vs draft; recomputed only when draft changes. */
    currentDiff() {
      return computeScheduleDiff(state.savedRuleSet, state.draft);
    },

    /**
     * Whether the OPEN diff preview may be confirmed right now: modal open,
     * rendered hash still equals the current draft hash, zero issues. This is
     * the pre-condition for ENABLING the modal's Confirm button; it is
     * distinct from canApply(), which additionally requires that the
     * confirmation has already landed.
     */
    canConfirmDiff() {
      if (!state.diffPreview.open) return false;
      if (state.issues.length > 0) return false;
      return state.diffPreview.renderedHash === computeScheduleDiff(state.savedRuleSet, state.draft).hash;
    },

    /**
     * Apply permission: requires an explicit confirmation whose hash still
     * equals the current diff hash AND zero open validation issues.
     */
    canApply() {
      if (state.confirmedHash === null) return false;
      if (state.issues.length > 0) return false;
      return state.confirmedHash === computeScheduleDiff(state.savedRuleSet, state.draft).hash;
    },
  };

  // ------------------------------------------------------------------ reducer

  function revalidate(base) {
    return { ...base, issues: validateDraft(base.draft, base.locations, base.services) };
  }

  function invalidateConfirmation(base) {
    return { ...base, confirmedHash: null };
  }

  /**
   * Terminal apply outcome shared shape: consent is consumed (one confirmed
   * diff = one apply attempt), the diff session closes, and the visible
   * outcome message is recorded. The saved baseline and draft are left for
   * each specific action to decide.
   */
  function terminalApply(base, applyStatus, lastApplyMessage) {
    return {
      ...base,
      applyStatus,
      lastApplyMessage,
      confirmedHash: null,
      diffPreview: { open: false, renderedHash: null },
    };
  }

  function reduce(current, action) {
    switch (action.type) {
      case '_INIT':
        return revalidate(current);

      // ------------------------------------------------------------ windows

      case 'ADD_WEEK_WINDOW': {
        const key = action.scopeType === 'service' ? 'serviceWindows' : 'locationWindows';
        const draft = cloneDraft(current.draft);
        draft[key][action.scopeId] = draft[key][action.scopeId] ?? {};
        const bucket = draft[key][action.scopeId];
        bucket[action.weekday] = Array.isArray(bucket[action.weekday]) ? bucket[action.weekday] : [];
        bucket[action.weekday].push({ start: '', end: '' });
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      case 'PATCH_WEEK_WINDOW': {
        const key = action.scopeType === 'service' ? 'serviceWindows' : 'locationWindows';
        const draft = cloneDraft(current.draft);
        const bucket = draft[key]?.[action.scopeId]?.[action.weekday];
        if (!Array.isArray(bucket) || !bucket[action.index]) return current;
        bucket[action.index] = { ...bucket[action.index], ...action.patch };
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      case 'REMOVE_WEEK_WINDOW': {
        const key = action.scopeType === 'service' ? 'serviceWindows' : 'locationWindows';
        const draft = cloneDraft(current.draft);
        const bucket = draft[key]?.[action.scopeId]?.[action.weekday];
        if (!Array.isArray(bucket) || !bucket[action.index]) return current;
        bucket.splice(action.index, 1);
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      // --------------------------------------------------------- exceptions

      case 'ADD_EXCEPTION': {
        const draft = cloneDraft(current.draft);
        draft.exceptions.push({
          exceptionId: nextExceptionId(),
          date: action.date ?? '',
          kind: 'CLOSED',
          windows: [],
          note: '',
        });
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      case 'UPDATE_EXCEPTION': {
        const draft = cloneDraft(current.draft);
        const index = draft.exceptions.findIndex((e) => e.exceptionId === action.exceptionId);
        if (index === -1) return current;
        draft.exceptions[index] = { ...draft.exceptions[index], ...action.patch };
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      case 'REMOVE_EXCEPTION': {
        const draft = cloneDraft(current.draft);
        draft.exceptions = draft.exceptions.filter((e) => e.exceptionId !== action.exceptionId);
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      // -------------------------------------------------------------- limits

      case 'SET_LIMIT': {
        const draft = cloneDraft(current.draft);
        const existing = draft.limits.find(
          (l) => l.dimension === action.dimension && (l.targetId ?? null) === (action.targetId ?? null),
        );
        // Canonicalize input: canonical integer strings become numbers, '-0'
        // stays a valid zero, empty clears the limit, and anything
        // non-canonical ('+5', '1.5', junk) is kept verbatim so the validator
        // can flag it visibly instead of silently coercing it.
        let value = action.rawValue;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed === '') {
            value = '';
          } else if (/^-?\d+$/.test(trimmed)) {
            value = Number(trimmed);
          } else {
            value = trimmed;
          }
        }
        if (
          value === '' ||
          value === undefined ||
          value === null ||
          (typeof value === 'number' && Number.isNaN(value))
        ) {
          draft.limits = draft.limits.filter((l) => l !== existing);
        } else if (existing) {
          existing.maxCount = value;
        } else {
          draft.limits.push({
            limitId: `limit-${draft.limits.length + 1}`,
            dimension: action.dimension,
            targetId: action.targetId ?? null,
            maxCount: value,
            includedStatuses: ['PENDING', 'CONFIRMED'],
          });
        }
        return revalidate(invalidateConfirmation({ ...current, draft }));
      }

      // ------------------------------------------------- review/confirm gate

      case 'OPEN_DIFF_PREVIEW': {
        // Layer 1 (reducer): refuse to open the consent dialog for an invalid
        // proposal; surface a visible notice instead.
        if (current.issues.length > 0) {
          return {
            ...current,
            notice: {
              kind: 'REVIEW_BLOCKED',
              message: `Fix ${current.issues.length} validation issue${current.issues.length === 1 ? '' : 's'} before reviewing changes.`,
            },
          };
        }
        const hash = computeScheduleDiff(current.savedRuleSet, current.draft).hash;
        return { ...current, notice: null, diffPreview: { open: true, renderedHash: hash } };
      }

      case 'CLOSE_DIFF_PREVIEW':
        return { ...current, diffPreview: { open: false, renderedHash: null }, notice: null };

      case 'CONFIRM_DIFF_PREVIEW': {
        const { hash } = action;
        const currentHash = computeScheduleDiff(current.savedRuleSet, current.draft).hash;
        const allowed =
          current.diffPreview.open &&
          current.diffPreview.renderedHash === hash &&
          hash === currentHash &&
          current.issues.length === 0;
        if (!allowed) return current; // stale or invalid: confirmation never lands
        return { ...current, confirmedHash: hash };
      }

      // ------------------------------------------------------- save / apply

      case 'SAVE_START':
        return { ...current, saveStatus: 'pending', lastSaveMessage: null };

      case 'SAVE_SUCCESS': {
        const savedRuleSet = cloneDraft(action.savedRuleSet ?? current.draft);
        return revalidate({
          ...current,
          savedRuleSet,
          draft: cloneDraft(savedRuleSet),
          confirmedHash: null,
          diffPreview: { open: false, renderedHash: null },
          saveStatus: 'saved',
          lastSaveMessage: 'Draft saved.',
        });
      }

      case 'SAVE_UNAVAILABLE':
        return {
          ...current,
          saveStatus: 'unavailable',
          lastSaveMessage: action.message,
        };

      case 'APPLY_START':
        return {
          ...current,
          applyStatus: 'pending',
          lastApplyMessage: null,
          // A fresh apply supersedes any previously tracked mutation and any
          // finished recovery session; consent is consumed by THIS attempt.
          lastMutation: null,
          recoverStatus: 'idle',
          lastRecoverySummary: null,
          lastRecoverMessage: null,
        };

      case 'APPLY_SUCCESS':
        return revalidate({
          ...terminalApply(current, 'applied', action.message ?? 'Schedule changes applied.'),
          savedRuleSet: cloneDraft(action.savedRuleSet ?? current.draft),
          draft: cloneDraft(action.savedRuleSet ?? current.draft),
        });

      case 'APPLY_ROLLED_BACK':
        // Schedules were restored server-side: saved baseline stays as-is,
        // the draft is preserved so the user can adjust and re-review.
        return terminalApply(current, 'rolled_back', action.message ?? 'The change set did not apply cleanly; schedules were rolled back.');

      case 'APPLY_RECOVERED':
        return terminalApply(current, 'recovered', action.message ?? 'An interrupted apply was recovered; schedules were restored.');

      case 'APPLY_FAILED':
        return terminalApply(current, 'failed', action.message ?? 'The apply ended in an unresolved state.');

      case 'APPLY_UNAVAILABLE':
        return {
          ...current,
          applyStatus: 'unavailable',
          lastApplyMessage: action.message,
        };

      case 'MUTATION_TRACKED': {
        // Observation from the status poller. The scope may arrive only on
        // some observations; keep the last known one (never fabricate one).
        const previous = current.lastMutation;
        const planId = typeof action.planId === 'string' ? action.planId : previous?.planId ?? null;
        if (!planId) return current;
        return {
          ...current,
          lastMutation: {
            planId,
            scope:
              action.scope && typeof action.scope === 'object'
                ? action.scope
                : previous?.scope ?? null,
            state: typeof action.state === 'string' ? action.state : previous?.state ?? null,
          },
        };
      }

      // ------------------------------------------------- explicit recovery

      case 'RECOVER_START':
        return { ...current, recoverStatus: 'pending', lastRecoverMessage: null };

      case 'RECOVER_RESULT':
        return {
          ...current,
          recoverStatus: 'done',
          lastRecoverySummary: action.summary && typeof action.summary === 'object' ? action.summary : null,
          lastRecoverMessage:
            action.summary && typeof action.summary === 'object' ? null : action.message ?? null,
        };

      case 'RECOVER_UNAVAILABLE':
        return {
          ...current,
          recoverStatus: 'unavailable',
          lastRecoverMessage: action.message,
        };

      case 'DISMISS_NOTICE':
        return { ...current, notice: null };

      default:
        return current;
    }
  }
}

/** Maps a thrown bridge failure to a user-safe visible message. */
export function describeBridgeFailure(error, verb) {
  if (isBridgeError(error)) {
    if (error.code === 'BRIDGE_NOT_CONFIGURED') {
      return `${verb} is unavailable: the app backend is not connected yet.`;
    }
    if (error.code === 'TRANSPORT_FAILURE') {
      return `${verb} failed: network problem. Check your connection and try again.`;
    }
    if (error.code === 'BAD_RESPONSE') {
      return `${verb} failed: the server sent an unreadable response.`;
    }
    if (error.code.startsWith('HTTP_')) {
      return `${verb} failed: server responded with status ${error.status}.`;
    }
  }
  return `${verb} failed unexpectedly. No changes were made.`;
}
