import { createServicesBridge } from './bridge.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DEFAULT_STATUSES = ['PENDING', 'CONFIRMED'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dateWeekday(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'MON';
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][parsed.getUTCDay()];
}

function windowRecordFromDto(record = {}) {
  const result = {};
  for (const [scopeId, rows] of Object.entries(record ?? {})) {
    const bucket = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const weekday = WEEKDAYS.includes(row?.weekday) ? row.weekday : null;
      if (!weekday) continue;
      bucket[weekday] = bucket[weekday] ?? [];
      bucket[weekday].push({ start: row.start ?? '', end: row.end ?? '' });
    }
    result[scopeId] = bucket;
  }
  return result;
}

function windowRecordToDto(record = {}) {
  const result = {};
  for (const [scopeId, bucket] of Object.entries(record ?? {})) {
    const rows = [];
    for (const weekday of WEEKDAYS) {
      for (const row of Array.isArray(bucket?.[weekday]) ? bucket[weekday] : []) {
        rows.push({ weekday, start: String(row.start ?? ''), end: String(row.end ?? '') });
      }
    }
    result[scopeId] = rows;
  }
  return result;
}

export function ruleSetDtoToDraft(ruleSet) {
  if (!ruleSet) {
    return { locationWindows: {}, serviceWindows: {}, exceptions: [], limits: [] };
  }
  return {
    locationWindows: windowRecordFromDto(ruleSet.locationWindows),
    serviceWindows: windowRecordFromDto(ruleSet.serviceWindows),
    exceptions: (ruleSet.exceptions ?? []).map((entry) => ({
      exceptionId: entry.exceptionId,
      date: entry.date,
      kind: entry.kind,
      windows: (entry.windows ?? []).map((row) => ({ start: row.start, end: row.end })),
      note: entry.reason ?? '',
    })),
    limits: (ruleSet.limits ?? []).map((entry) => ({
      limitId: entry.limitId,
      dimension: entry.dimension,
      targetId: entry.targetId ?? null,
      maxCount: entry.maxCount,
      includedStatuses: Array.isArray(entry.includedStatuses)
        ? [...entry.includedStatuses]
        : [...DEFAULT_STATUSES],
    })),
  };
}

function stableLimitId(limit, index, previous) {
  const key = `${limit.dimension}::${limit.targetId ?? ''}`;
  const old = (previous?.limits ?? []).find(
    (entry) => `${entry.dimension}::${entry.targetId ?? ''}` === key,
  );
  if (old?.limitId) return old.limitId;
  return `limit-${String(limit.dimension).toLowerCase()}-${limit.targetId ?? 'all'}-${index + 1}`;
}

export function draftToRuleSetDto(draft, previousRuleSet = null) {
  const previous = previousRuleSet ?? null;
  const nextVersion = Math.max(1, Number(previous?.version ?? 0) + 1);
  const ruleSetId = previous?.ruleSetId ?? 'advanced-booking-rules';
  const revision = previous?.revision ?? 'new';
  return {
    ruleSetId,
    revision,
    version: nextVersion,
    locationWindows: windowRecordToDto(draft?.locationWindows),
    serviceWindows: windowRecordToDto(draft?.serviceWindows),
    exceptions: (draft?.exceptions ?? []).map((entry, index) => ({
      exceptionId: entry.exceptionId || `exception-${entry.date || index + 1}`,
      date: String(entry.date ?? ''),
      kind: entry.kind === 'OVERRIDE' ? 'OVERRIDE' : 'CLOSED',
      ...(entry.kind === 'OVERRIDE'
        ? {
            windows: (entry.windows ?? []).map((row) => ({
              weekday: dateWeekday(entry.date),
              start: String(row.start ?? ''),
              end: String(row.end ?? ''),
            })),
          }
        : {}),
      ...(typeof entry.note === 'string' && entry.note.trim()
        ? { reason: entry.note.trim() }
        : {}),
    })),
    limits: (draft?.limits ?? []).map((entry, index) => ({
      limitId: entry.limitId || stableLimitId(entry, index, previous),
      dimension: entry.dimension,
      ...(entry.targetId ? { targetId: entry.targetId } : {}),
      maxCount: Number(entry.maxCount),
      includedStatuses:
        Array.isArray(entry.includedStatuses) && entry.includedStatuses.length
          ? [...entry.includedStatuses]
          : [...DEFAULT_STATUSES],
    })),
  };
}

/** Runtime wrapper around the tested authenticated transport bridge. */
export function createRuntimeServicesBridge(options = {}) {
  const base = createServicesBridge({ ...options, baseUrl: options.baseUrl ?? '/api' });
  return {
    ...base,
    async getActiveRuleSet() {
      const response = await base.request('/ruleset', { method: 'GET' });
      if (response && typeof response === 'object' && 'ruleSet' in response) {
        return response.ruleSet ?? null;
      }
      return response ?? null;
    },
    async saveRuleSet(ruleSet) {
      const response = await base.request('/ruleset', {
        method: 'PUT',
        body: {
          ruleSet,
          expectedRevision: ruleSet?.revision || 'new',
        },
      });
      if (response && typeof response === 'object' && 'ruleSet' in response) {
        return response.ruleSet;
      }
      return response;
    },
  };
}

export function cloneDraft(value) {
  return clone(value);
}
