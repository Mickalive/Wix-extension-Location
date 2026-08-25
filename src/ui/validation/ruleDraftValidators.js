/**
 * Provisional configuration-draft validators (dashboard lane bundle).
 *
 * DECISION OF RECORD (audit F-N1, structural): rule-configuration validation
 * semantics belong to the rules lane (`src/domain/**`, Blueprint section 2).
 * Those canonical validators do not exist in the accepted base yet, and path
 * ownership forbids this lane from creating them. Until the Rules lane reaches
 * VERDICT: ACCEPT, this module carries a deliberately narrow mirror of the
 * draft-shape rules so the UI can block invalid proposals. It is wired through
 * the single repoint seam `validation/mirror.js` (`setValidationSource`), and
 * the Director-tracked obligation is to repoint that seam at the canonical
 * domain validators plus add a cross-lane parity contract test. Messages here
 * are therefore provisional until that repoint lands.
 *
 * Purity: no I/O, no Wix access, fully deterministic.
 */

/**
 * @typedef {Object} DraftIssue
 * @property {string} code - stable machine code (programmatic use only)
 * @property {string} message - user-facing text rendered verbatim by the UI
 * @property {string} path - dotted location of the offending input
 */

const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEKDAY_SET = new Set(WEEKDAY_ORDER);

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toMinutes(time) {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Month is 1-indexed (DATE_PATTERN captures calendar months, not JS indexes). */
function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** Calendar-validity check incl. leap years (2028-02-29 valid, 2027-02-29 not). */
export function isValidLocalDate(date) {
  const match = DATE_PATTERN.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

function issue(code, message, path) {
  return { code, message, path };
}

/**
 * Validates one weekly window row.
 * @returns {DraftIssue[]}
 */
export function validateWindowRow(scopeType, scopeId, weekday, index, row) {
  const path = `${scopeType}s.${scopeId}.${weekday}[${index}]`;
  const issues = [];
  const startMissing = !row || typeof row.start !== 'string' || row.start.trim() === '';
  const endMissing = !row || typeof row.end !== 'string' || row.end.trim() === '';
  if (startMissing && endMissing) {
    // A completely empty row is incomplete input, not yet an error the user
    // must fix — but it must never reach the diff either. The store treats
    // "any issue" as review-blocking, so surface it explicitly.
    issues.push(
      issue(
        'WINDOW_INCOMPLETE',
        `Window ${index + 1} on ${weekday} needs both a start and an end time.`,
        path,
      ),
    );
    return issues;
  }
  if (startMissing || endMissing) {
    issues.push(
      issue(
        'WINDOW_HALF_EMPTY',
        startMissing
          ? `Window ${index + 1} on ${weekday} is missing its start time.`
          : `Window ${index + 1} on ${weekday} is missing its end time.`,
        path,
      ),
    );
    return issues;
  }
  const start = row.start.trim();
  const end = row.end.trim();
  if (!TIME_PATTERN.test(start)) {
    issues.push(issue('WINDOW_BAD_START', `Window ${index + 1} on ${weekday} has an invalid start time "${row.start}" (use HH:MM, 24-hour).`, path));
  }
  if (!TIME_PATTERN.test(end)) {
    issues.push(issue('WINDOW_BAD_END', `Window ${index + 1} on ${weekday} has an invalid end time "${row.end}" (use HH:MM, 24-hour).`, path));
  }
  if (issues.length > 0) return issues;
  const startMin = /** @type {number} */ (toMinutes(start));
  const endMin = /** @type {number} */ (toMinutes(end));
  if (startMin === endMin) {
    issues.push(issue('WINDOW_ZERO_LENGTH', `Window ${index + 1} on ${weekday} has the same start and end time; it must span at least one minute.`, path));
  } else if (endMin < startMin) {
    issues.push(issue('WINDOW_END_BEFORE_START', `Window ${index + 1} on ${weekday}: end time must be after start time.`, path));
  }
  return issues;
}

/**
 * Overlap detection within one weekday bucket. Adjacent windows
 * (09:00-12:00 followed by 12:00-14:00) are allowed; genuine overlaps produce
 * one issue per overlapping pair.
 * @returns {DraftIssue[]}
 */
export function validateWindowBucket(scopeType, scopeId, weekday, rows) {
  const issues = [];
  rows.forEach((row, index) => {
    issues.push(...validateWindowRow(scopeType, scopeId, weekday, index, row));
  });
  const parsed = [];
  rows.forEach((row, index) => {
    if (!row || typeof row.start !== 'string' || typeof row.end !== 'string') return;
    const startMin = toMinutes(row.start.trim());
    const endMin = toMinutes(row.end.trim());
    if (startMin === null || endMin === null || endMin <= startMin) return;
    parsed.push({ index, startMin, endMin });
  });
  for (let a = 0; a < parsed.length; a += 1) {
    for (let b = a + 1; b < parsed.length; b += 1) {
      const first = /** @type {{index:number,startMin:number,endMin:number}} */ (parsed[a]);
      const second = /** @type {{index:number,startMin:number,endMin:number}} */ (parsed[b]);
      const overlaps = first.startMin < second.endMin && second.startMin < first.endMin;
      if (overlaps) {
        issues.push(
          issue(
            'WINDOW_OVERLAP',
            `Windows ${first.index + 1} and ${second.index + 1} on ${weekday} overlap; split hours must not intersect.`,
            `${scopeType}s.${scopeId}.${weekday}`,
          ),
        );
      }
    }
  }
  return issues;
}

/**
 * Validates one cap value. Accepts numbers and raw input strings:
 *   - '' / null / undefined  -> no limit configured (valid);
 *   - integers >= 0 (incl. -0) -> valid;
 *   - anything else ('+5', '1.5', 'abc', non-integer numbers) -> rejected.
 * The store keeps non-canonical strings in the draft precisely so this
 * validator can flag them instead of silently coercing them.
 * @returns {DraftIssue[]}
 */
export function validateLimit(dimension, targetId, rawValue) {
  const label = targetId ? `${dimension.toLowerCase()} limit for ${targetId}` : `${dimension.toLowerCase()} limit`;
  const path = `limits.${dimension}${targetId ? `.${targetId}` : ''}`;
  if (rawValue === undefined || rawValue === null || rawValue === '') return [];
  if (typeof rawValue === 'string') {
    // Non-canonical leftovers from free-text input: only canonical integer
    // strings are acceptable.
    return [issue('LIMIT_NOT_INTEGER', `The ${label} must be a whole number.`, path)];
  }
  if (!Number.isInteger(rawValue)) {
    return [issue('LIMIT_NOT_INTEGER', `The ${label} must be a whole number.`, path)];
  }
  if (rawValue < 0) {
    return [issue('LIMIT_NEGATIVE', `The ${label} cannot be negative.`, path)];
  }
  return [];
}

/**
 * Validates one dated exception.
 * @returns {DraftIssue[]}
 */
export function validateException(exception, allExceptions) {
  const id = exception?.exceptionId ?? '?';
  const path = `exceptions.${id}`;
  const issues = [];
  if (typeof exception.date !== 'string' || exception.date.trim() === '') {
    issues.push(issue('EXCEPTION_DATE_MISSING', 'Every exception needs a date.', path));
  } else if (!isValidLocalDate(exception.date.trim())) {
    issues.push(issue('EXCEPTION_DATE_INVALID', `"${exception.date}" is not a real calendar date (use YYYY-MM-DD).`, path));
  }
  if (exception.kind !== 'CLOSED' && exception.kind !== 'OVERRIDE') {
    issues.push(issue('EXCEPTION_KIND_UNKNOWN', 'Exception type must be "closed all day" or "open override".', path));
  }
  if (exception.kind === 'OVERRIDE') {
    const windows = Array.isArray(exception.windows) ? exception.windows : [];
    const complete = windows.filter(
      (w) =>
        w &&
        typeof w.start === 'string' && w.start.trim() !== '' &&
        typeof w.end === 'string' && w.end.trim() !== '',
    );
    if (complete.length === 0) {
      issues.push(issue('EXCEPTION_OVERRIDE_EMPTY', `Override on ${exception.date || '(no date)'} needs at least one open window.`, path));
    }
    complete.forEach((w, i) => {
      const startMin = toMinutes(w.start.trim());
      const endMin = toMinutes(w.end.trim());
      if (startMin === null || endMin === null) {
        issues.push(issue('EXCEPTION_WINDOW_TIME_INVALID', `Override window ${i + 1} on ${exception.date || '(no date)'} has an invalid time (use HH:MM, 24-hour).`, path));
      } else if (endMin <= startMin) {
        issues.push(issue('EXCEPTION_WINDOW_ORDER', `Override window ${i + 1} on ${exception.date || '(no date)'}: end time must be after start time.`, path));
      }
    });
  }
  const dateValue = typeof exception.date === 'string' ? exception.date.trim() : '';
  if (dateValue !== '' && isValidLocalDate(dateValue)) {
    const duplicates = (allExceptions ?? []).filter(
      (other) => other !== exception && typeof other.date === 'string' && other.date.trim() === dateValue,
    );
    if (duplicates.length > 0) {
      issues.push(issue('EXCEPTION_DUPLICATE_DATE', `There is more than one exception for ${dateValue}; merge them into one entry.`, path));
    }
  }
  return issues;
}

/**
 * Whole-draft validation. Deterministic ordering: weekly windows by scope then
 * weekday, exceptions by list order, limits last.
 *
 * @param {object} draft - `{ locationWindows, serviceWindows, exceptions, limits }`
 * @param {Array<{id:string,label:string}>} [locations]
 * @param {Array<{id:string,label:string}>} [services]
 * @returns {DraftIssue[]}
 */
export function validateRuleDraft(draft, locations = [], services = []) {
  const issues = [];

  const scopeEntries = [
    { scopeType: 'location', scopes: draft.locationWindows ?? {}, catalog: locations },
    { scopeType: 'service', scopes: draft.serviceWindows ?? {}, catalog: services },
  ];
  for (const { scopeType, scopes, catalog } of scopeEntries) {
    const knownIds = new Set(catalog.map((entry) => entry.id));
    for (const scopeId of Object.keys(scopes)) {
      const bucket = scopes[scopeId] ?? {};
      for (const weekday of Object.keys(bucket)) {
        if (!WEEKDAY_SET.has(weekday)) {
          issues.push(
            issue(
              'WEEKDAY_UNKNOWN',
              `"${weekday}" is not a weekday this editor manages (use MON..SUN).`,
              `${scopeType}s.${scopeId}.${weekday}`,
            ),
          );
          continue;
        }
        const rows = Array.isArray(bucket[weekday]) ? bucket[weekday] : [];
        issues.push(...validateWindowBucket(scopeType, scopeId, weekday, rows));
      }
      if (catalog.length > 0 && !knownIds.has(scopeId)) {
        issues.push(
          issue(
            'SCOPE_UNKNOWN',
            `Windows reference ${scopeType} "${scopeId}", which is not in the site's ${scopeType} list.`,
            `${scopeType}s.${scopeId}`,
          ),
        );
      }
    }
  }

  for (const exception of draft.exceptions ?? []) {
    issues.push(...validateException(exception, draft.exceptions ?? []));
  }

  for (const limit of draft.limits ?? []) {
    issues.push(...validateLimit(limit.dimension, limit.targetId, limit.maxCount));
  }

  return issues;
}

export const CANONICAL_WEEKDAYS = WEEKDAY_ORDER;
