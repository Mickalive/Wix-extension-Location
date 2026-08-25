/**
 * Deterministic schedule diff between the saved rule set and the working
 * draft. Produces an ordered operation list plus a stable hash; the hash is
 * the informed-consent token for Contract section 9.2: the user confirms the
 * exact rendered diff, and apply is only permitted while that hash still
 * describes the current draft.
 *
 * Purity: no I/O, no Wix access, deterministic ordering on identical inputs.
 */

export const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEKDAY_RANK = new Map(WEEKDAY_ORDER.map((day, index) => [day, index]));

const SCOPE_TYPE_ORDER = { location: 0, service: 1 };
const LIMIT_DIMENSION_ORDER = { DAY: 0, SERVICE: 1, LOCATION: 2 };

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Normalizes a weekday bucket key for ordering: canonical weekdays keep their
 * MON..SUN order; unknown keys sort after all canonical ones, alphabetically,
 * so they stay visible instead of being silently dropped (audit F-N7).
 */
function weekdaySortKey(weekday) {
  const rank = WEEKDAY_RANK.get(weekday);
  if (rank !== undefined) return `0:${String(rank).padStart(2, '0')}`;
  return `1:${weekday}`;
}

function windowKey(row) {
  return `${row.start}-${row.end}`;
}

function normalizeWindows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valid = [];
  for (const row of list) {
    // Incomplete rows never become schedule operations: validators flag them
    // as issues, and issues block review/confirm before any diff is shown.
    if (
      row &&
      typeof row.start === 'string' && row.start.trim() !== '' &&
      typeof row.end === 'string' && row.end.trim() !== ''
    ) {
      valid.push({ start: row.start.trim(), end: row.end.trim() });
    }
  }
  return valid.sort((a, b) =>
    a.start === b.start ? compareStrings(a.end, b.end) : compareStrings(a.start, b.start),
  );
}

function normalizeException(exception) {
  return {
    exceptionId: exception.exceptionId,
    date: String(exception.date ?? '').trim(),
    kind: exception.kind,
    windows: normalizeWindows(exception.windows),
    note:
      typeof exception.note === 'string' && exception.note.trim() !== ''
        ? exception.note.trim()
        : null,
  };
}

/** @returns {{kind:string,start:string,end:string}[]} ops for one scope bucket */
export function windowOpsForScope(scopeType, scopeId, savedBucket, draftBucket) {
  const ops = [];
  const savedByWeekday = savedBucket ?? {};
  const draftByWeekday = draftBucket ?? {};

  // Union of keys from BOTH sides — a weekday bucket that exists only in
  // saved data or only in draft data must still be compared, and a
  // non-canonical bucket must be surfaced, never dropped silently (F-N7).
  const weekdays = [...new Set([...Object.keys(savedByWeekday), ...Object.keys(draftByWeekday)])].sort(
    (a, b) => compareStrings(weekdaySortKey(a), weekdaySortKey(b)),
  );

  for (const weekday of weekdays) {
    if (!WEEKDAY_RANK.has(weekday)) {
      ops.push({ kind: 'UNKNOWN_WEEKDAY', scopeType, scopeId, weekday });
      continue;
    }
    const saved = normalizeWindows(savedByWeekday[weekday]);
    const draft = normalizeWindows(draftByWeekday[weekday]);
    const savedKeys = new Set(saved.map(windowKey));
    const draftKeys = new Set(draft.map(windowKey));
    for (const row of saved) {
      if (!draftKeys.has(windowKey(row))) {
        ops.push({ kind: 'REMOVE_WINDOW', scopeType, scopeId, weekday, start: row.start, end: row.end });
      }
    }
    for (const row of draft) {
      if (!savedKeys.has(windowKey(row))) {
        ops.push({ kind: 'ADD_WINDOW', scopeType, scopeId, weekday, start: row.start, end: row.end });
      }
    }
  }
  return ops;
}

function windowOpsForScopeType(scopeType, savedRecord, draftRecord) {
  const savedScopes = savedRecord ?? {};
  const draftScopes = draftRecord ?? {};
  const scopeIds = [...new Set([...Object.keys(savedScopes), ...Object.keys(draftScopes)])].sort(
    compareStrings,
  );
  const ops = [];
  for (const scopeId of scopeIds) {
    ops.push(
      ...windowOpsForScope(scopeType, scopeId, savedScopes[scopeId], draftScopes[scopeId]),
    );
  }
  return ops;
}

function exceptionOps(savedExceptions, draftExceptions) {
  const savedList = (Array.isArray(savedExceptions) ? savedExceptions : []).map(normalizeException);
  const draftList = (Array.isArray(draftExceptions) ? draftExceptions : []).map(normalizeException);
  const savedByDate = new Map(savedList.map((entry) => [entry.date, entry]));
  const draftByDate = new Map(draftList.map((entry) => [entry.date, entry]));

  const dates = [...new Set([...savedByDate.keys(), ...draftByDate.keys()])].sort(compareStrings);
  const ops = [];
  for (const date of dates) {
    const saved = savedByDate.get(date);
    const draft = draftByDate.get(date);
    if (saved && !draft) {
      ops.push({ kind: 'REMOVE_EXCEPTION', date, removed: saved });
    } else if (!saved && draft) {
      ops.push({ kind: 'ADD_EXCEPTION', date, added: draft });
    } else if (saved && draft) {
      const changed =
        saved.kind !== draft.kind ||
        JSON.stringify(saved.windows) !== JSON.stringify(draft.windows) ||
        saved.note !== draft.note;
      if (changed) {
        ops.push({ kind: 'UPDATE_EXCEPTION', date, before: saved, after: draft });
      }
    }
  }
  return ops;
}

function limitOps(savedLimits, draftLimits) {
  const keyOf = (limit) => `${limit.dimension}::${limit.targetId ?? ''}`;
  const savedMap = new Map(
    (Array.isArray(savedLimits) ? savedLimits : []).map((limit) => [keyOf(limit), limit]),
  );
  const draftMap = new Map(
    (Array.isArray(draftLimits) ? draftLimits : []).map((limit) => [keyOf(limit), limit]),
  );
  const keys = [...new Set([...savedMap.keys(), ...draftMap.keys()])];
  const parsed = keys.map((key) => {
    const [dimension, targetId] = key.split('::');
    return {
      dimension,
      targetId: targetId === '' ? null : targetId,
      dimRank: LIMIT_DIMENSION_ORDER[dimension] ?? 99,
      saved: savedMap.get(key),
      draft: draftMap.get(key),
    };
  });
  parsed.sort(
    (a, b) =>
      a.dimRank - b.dimRank ||
      compareStrings(a.targetId ?? '', b.targetId ?? ''),
  );
  const ops = [];
  for (const entry of parsed) {
    const before = entry.saved ? entry.saved.maxCount : null;
    const after = entry.draft ? entry.draft.maxCount : null;
    if (before !== after) {
      ops.push({
        kind: 'SET_LIMIT',
        dimension: entry.dimension,
        targetId: entry.targetId,
        before,
        after,
      });
    }
  }
  return ops;
}

/**
 * @param {object|null} savedRuleSet
 * @param {object} draftRuleSet
 * @returns {{ops: Array<object>, hash: string}}
 */
export function computeScheduleDiff(savedRuleSet, draftRuleSet) {
  const saved = savedRuleSet ?? {};
  const draft = draftRuleSet ?? {};
  const ops = [
    ...windowOpsForScopeType('location', saved.locationWindows, draft.locationWindows),
    ...windowOpsForScopeType('service', saved.serviceWindows, draft.serviceWindows),
    ...exceptionOps(saved.exceptions, draft.exceptions),
    ...limitOps(saved.limits, draft.limits),
  ];
  return { ops, hash: fnv1aHex(stableStringify(ops)) };
}

// --------------------------------------------------------------------- hashing

/** Stable serialization: object keys sorted, arrays in given order. */
export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** FNV-1a 32-bit, hex-encoded. Deterministic across runs and processes. */
export function fnv1aHex(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ describing

function formatHours(windows) {
  if (!windows || windows.length === 0) return '(no windows)';
  return windows.map((w) => `${w.start}-${w.end}`).join(', ');
}

/**
 * Human phrase for an exception state, e.g. "closed all day" or
 * "open 10:00-14:00, 15:00-18:00".
 */
export function describeExceptionState(kind, windows) {
  if (kind === 'CLOSED') return 'closed all day';
  if (kind === 'OVERRIDE') return `open ${formatHours(windows)}`;
  return `unknown type ${String(kind)}`;
}

function quoteNote(note) {
  return `'${note}'`;
}

/**
 * Renders one diff operation as the exact human-readable consent line shown in
 * the review modal.
 *
 * Contract section 9.2 requires that the dialog shows exactly what will
 * change. For exception mutations that means BOTH states must be visible:
 *   UPDATE_EXCEPTION -> "Change exception - <date>: <before> -> <after>"
 *     e.g. "Change exception - 2026-12-25: closed all day -> open 10:00-14:00"
 *     including note changes when present.
 *   REMOVE_EXCEPTION -> the removed entry's kind and hours must be described,
 *     not just its date.
 *
 * @returns {string}
 */
export function describeOp(op) {
  switch (op.kind) {
    case 'ADD_WINDOW':
      return `Add window - ${op.scopeType} ${op.scopeId}, ${op.weekday}: ${op.start}-${op.end}`;
    case 'REMOVE_WINDOW':
      return `Remove window - ${op.scopeType} ${op.scopeId}, ${op.weekday}: ${op.start}-${op.end}`;
    case 'ADD_EXCEPTION': {
      const added = op.added;
      let line = `Add exception - ${op.date}: ${describeExceptionState(added.kind, added.windows)}`;
      if (added.note) line += ` (note: ${quoteNote(added.note)})`;
      return line;
    }
    case 'UPDATE_EXCEPTION': {
      const beforeDesc = describeExceptionState(op.before.kind, op.before.windows);
      const afterDesc = describeExceptionState(op.after.kind, op.after.windows);
      let line = `Change exception - ${op.date}: ${beforeDesc} -> ${afterDesc}`;
      if (op.before.note !== op.after.note) {
        if (op.before.note && op.after.note) {
          line += ` (note: ${quoteNote(op.before.note)} -> ${quoteNote(op.after.note)})`;
        } else if (op.after.note) {
          line += ` (note added: ${quoteNote(op.after.note)})`;
        } else {
          line += ` (note removed: ${quoteNote(op.before.note)})`;
        }
      }
      return line;
    }
    case 'REMOVE_EXCEPTION': {
      const removed = op.removed;
      let line = `Remove exception - ${op.date}: ${describeExceptionState(removed.kind, removed.windows)}`;
      if (removed.note) line += ` (note: ${quoteNote(removed.note)})`;
      return line;
    }
    case 'SET_LIMIT': {
      const scope = op.targetId ? ` for ${op.targetId}` : '';
      const fmt = (value) => (value === null || value === undefined ? 'none' : String(value));
      return `Set ${op.dimension.toLowerCase()} booking limit${scope}: ${fmt(op.before)} -> ${fmt(op.after)} per ${op.dimension === 'DAY' ? 'day' : op.dimension.toLowerCase()}`;
    }
    case 'UNKNOWN_WEEKDAY':
      return `Unknown weekday "${op.weekday}" under ${op.scopeType} ${op.scopeId} - resolve this entry before applying`;
    default:
      return `Unsupported change of kind ${String(op?.kind)}`;
  }
}

/** Convenience: describe every op (used by the modal and tests). */
export function describeOps(ops) {
  return ops.map(describeOp);
}
