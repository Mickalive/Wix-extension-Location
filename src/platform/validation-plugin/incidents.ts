/**
 * Degradation records — the "logged + surfaced, never silent" seam
 * (INT-C3-1 items c/e/f; Blueprint §4 flows 1/4/5; Contract §5.3/§7/§11 C5).
 *
 * Every degradation of the enforcement path produces a typed record that is
 * BOTH returned in the handler result (`degradations[]` — always available to
 * the caller even if persistence fails) AND pushed to the injected
 * {@link DegradationSink}, whose production adapter logs, alerts and persists
 * (data collection) at scaffold time. A failing sink must never alter a
 * booking outcome: handlers guard sink writes (see safeRecord).
 *
 * Purity: no Wix imports; the sink is an injected port.
 */

import type { Instant } from '../../shared/types';
import type { ValidationTarget } from './targets';

export type DegradationKind =
  /** Entitlement gate port threw (billing API failure) ⇒ fail-open coverage. */
  | 'ENTITLEMENT_GATE_FAILURE'
  /** Gate resolved with `degraded: true`; its warning is surfaced verbatim. */
  | 'ENTITLEMENT_DEGRADED'
  /** Count gateway failed for a query ⇒ caps degrade per rule configuration. */
  | 'COUNT_GATEWAY_FAILURE'
  /** A derivable count query missed the pre-resolved cache (internal invariant). */
  | 'COUNT_CACHE_MISS'
  /** Existing-bookings read failed ⇒ duplicate layer degrades to native protection. */
  | 'DUPLICATE_INPUT_FAILURE'
  /**
   * Subject-booking-facts seam threw (INT-C5-1) ⇒ facts treated as
   * UNAVAILABLE: RESCHEDULE self-exclusion/self-count stay inert and behavior
   * is identical to the default seam. Never hides, never fabricates facts.
   */
  | 'SUBJECT_FACTS_FAILURE'
  /** RESCHEDULE internal error/timeout ⇒ rules NOT enforced for this call. */
  | 'ENFORCEMENT_FAIL_OPEN'
  /** CREATE/CANCEL internal error/timeout ⇒ all items blocked with retry hint. */
  | 'ENFORCEMENT_FAIL_CLOSED';

export interface DegradationRecord {
  kind: DegradationKind;
  at: Instant;
  target?: ValidationTarget;
  /** Human-readable detail for logs/dashboards. NEVER carries payload PII. */
  detail: string;
  /** Stable count-query key when kind === COUNT_GATEWAY_FAILURE | COUNT_CACHE_MISS. */
  countQueryKey?: string;
}

/**
 * Production sink contract: log + alert + persist one degradation record.
 * Implementations MUST be local-first (in-process log before any remote
 * write) so a persistence outage cannot silently swallow the incident.
 */
export interface DegradationSink {
  record(degradation: DegradationRecord): Promise<void>;
}

/** Reference/test sink: bounded in-memory ring, records observable in tests. */
export class InMemoryDegradationSink implements DegradationSink {
  readonly records: DegradationRecord[] = [];
  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  async record(degradation: DegradationRecord): Promise<void> {
    this.records.push(degradation);
    if (this.records.length > this.capacity) {
      this.records.shift();
    }
  }
}

/**
 * Sink write guard: monitoring must never change a booking outcome. Sink
 * failures are swallowed HERE by design — the record remains in the handler
 * result's `degradations[]`, so the incident is still surfaced to the caller.
 */
export async function safeRecord(sink: DegradationSink, degradation: DegradationRecord): Promise<void> {
  try {
    await sink.record(degradation);
  } catch {
    // Deliberate: see module docstring. Never rethrow into the booking path.
  }
}
