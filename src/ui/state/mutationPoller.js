/**
 * Mutation-status poll controller (DASH-C3-1; Blueprint §4 flow 3).
 *
 * After requestApply() is accepted, the page polls the mutation journal via
 * bridge.getMutationStatus(planId) until the journal reaches a TERMINAL
 * state, then stops permanently. Terminal semantics mirror the accepted
 * orchestrator exactly (src/platform/schedule-mutation/orchestrator.ts):
 * every state OUTSIDE the non-terminal allowlist {SNAPSHOT_PERSISTED,
 * APPLY_IN_PROGRESS} is terminal — so a future state addition can never
 * silently keep this loop running.
 *
 * Safety properties (each proven by tests/ui/mutationPoller.test.js):
 *   - BOUNDED: at most `maxAttempts` getStatus() calls; the loop always
 *     terminates even if every observation is non-terminal or null.
 *   - STOPS ON TERMINAL: the first terminal observation returns immediately;
 *     no further getStatus() call happens afterwards.
 *   - STOPS ON ERROR: a rejected getStatus() returns an ERROR outcome after
 *     exactly that attempt; polling never resumes by itself.
 *   - OBSERVER FAULTS ARE CONTAINED (audit N-C, CYCLE_32792897988_DASHBOARD):
 *     an exception thrown by onObservation is wrapped into the same ERROR
 *     outcome instead of propagating; polling stops permanently either way.
 *   - NO AUTO-RECOVERY: this controller only READS status. It never calls
 *     recover() and never re-applies anything (Contract §9.2 explicit-intent
 *     rule); recovery is a separate, click-only affordance in the page.
 *
 * Purity: no I/O of its own — getStatus/delay/cancel are all injected, so
 * tests run fully offline and deterministically.
 */

/**
 * Journal states that describe an apply still in flight. Mirrors the
 * orchestrator's NON_TERMINAL_STATES allowlist verbatim.
 */
export const NON_TERMINAL_MUTATION_STATES = new Set(['SNAPSHOT_PERSISTED', 'APPLY_IN_PROGRESS']);

/**
 * True when a journal state is terminal. Unknown/non-string states are
 * treated as NOT terminal here only when they are empty/absent; any real
 * state string outside the allowlist is terminal (fail-safe stop).
 */
export function isTerminalMutationState(state) {
  return typeof state === 'string' && !NON_TERMINAL_MUTATION_STATES.has(state);
}

/** Maps a terminal journal state to its user-facing outcome kind. */
export function classifyTerminalState(state) {
  switch (state) {
    case 'APPLY_COMPLETED':
      return 'APPLIED';
    case 'ROLLED_BACK':
      return 'ROLLED_BACK';
    case 'RECOVERED':
      return 'RECOVERED';
    default:
      // Any other terminal state (including future additions): honest
      // failed-terminal outcome carrying the raw state for display.
      return 'FAILED_TERMINAL';
  }
}

function defaultDelayFn(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `getStatus()` until a terminal journal state, a bridge error, the
 * attempt bound, or cancellation.
 *
 * @param {object} options
 * @param {() => Promise<object|null>} options.getStatus - one status probe
 *   (bridge.getMutationStatus bound to the plan id). Null means "no journal
 *   record visible yet" and counts as a non-terminal observation.
 * @param {number} [options.maxAttempts] - hard upper bound of probes. Default 8.
 * @param {number} [options.delayMs] - delay between probes. Default 1500.
 * @param {(ms: number) => Promise<void>} [options.delayFn] - injectable delay
 *   (tests pass an immediate resolver for determinism).
 * @param {(projection: object) => void} [options.onObservation] - called with
 *   every non-null projection BEFORE the terminal check, so the page can
 *   track planId/scope/state as soon as they become known.
 * @param {() => boolean} [options.isCancelled] - polled between steps; when
 *   true the loop abandons with a CANCELLED outcome (page teardown hygiene).
 * @returns {Promise<
 *   | {kind: 'APPLIED'|'ROLLED_BACK'|'RECOVERED', state: string, projection: object, attempts: number}
 *   | {kind: 'FAILED_TERMINAL', state: string, projection: object, attempts: number}
 *   | {kind: 'EXHAUSTED', attempts: number, lastState: string|null, lastProjection: object|null}
 *   | {kind: 'ERROR', error: unknown, attempts: number, lastState: string|null, lastProjection: object|null}
 *   | {kind: 'CANCELLED', attempts: number, lastState: string|null, lastProjection: object|null}
 * >}
 */
export async function pollMutationUntilTerminal(options) {
  const getStatus = options.getStatus;
  const maxAttempts = options.maxAttempts ?? 8;
  const delayMs = options.delayMs ?? 1500;
  const delayFn = options.delayFn ?? defaultDelayFn;
  const onObservation = options.onObservation ?? null;
  const isCancelled = options.isCancelled ?? (() => false);

  let attempts = 0;
  let lastState = null;
  let lastProjection = null;

  while (attempts < maxAttempts && !isCancelled()) {
    attempts += 1;

    let projection;
    try {
      projection = await getStatus();
    } catch (error) {
      // Bridge error: stop permanently. The caller renders guidance; nothing
      // retries automatically.
      return { kind: 'ERROR', error, attempts, lastState, lastProjection };
    }
    if (isCancelled()) {
      return { kind: 'CANCELLED', attempts, lastState, lastProjection };
    }

    if (projection !== null && typeof projection === 'object') {
      lastProjection = projection;
      lastState = typeof projection.state === 'string' ? projection.state : null;
      if (onObservation) {
        try {
          onObservation(projection);
        } catch (error) {
          // Audit N-C (CYCLE_32792897988_DASHBOARD): an observer exception is
          // a caller-side bug, but it must never escape as an unhandled
          // rejection nor leave the loop half-alive. Wrap it into the same
          // ERROR outcome used for probe failures and stop permanently.
          return { kind: 'ERROR', error, attempts, lastState, lastProjection };
        }
      }
      if (isTerminalMutationState(projection.state)) {
        return {
          kind: classifyTerminalState(projection.state),
          state: projection.state,
          projection,
          attempts,
        };
      }
    }

    // Non-terminal (or not-yet-visible) observation: wait before the next
    // probe — but never delay after the final allowed attempt.
    if (attempts < maxAttempts && !isCancelled()) {
      await delayFn(delayMs);
    }
  }

  if (isCancelled()) {
    return { kind: 'CANCELLED', attempts, lastState, lastProjection };
  }
  return { kind: 'EXHAUSTED', attempts, lastState, lastProjection };
}
