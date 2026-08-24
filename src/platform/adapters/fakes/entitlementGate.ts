/**
 * In-memory fake {@link EntitlementGate} (Blueprint §3; Contract §7, §11 C5).
 * Returns a configured PolicyDecision; knobs let tests exercise the fail-open
 * degraded posture and over-limit coverage signals.
 */
import { PlatformError } from '../../contracts';
import type { EntitlementGate, PolicyDecision } from '../../contracts';

export class FakeEntitlementGate implements EntitlementGate {
  private decision: PolicyDecision;
  private failure: Error | null = null;

  constructor(decision: PolicyDecision) {
    this.decision = structuredClone(decision);
  }

  setDecision(decision: PolicyDecision): void {
    this.decision = structuredClone(decision);
  }

  /** Test knob: next call rejects (simulated billing/count API outage). */
  failNextWith(error: Error): void {
    this.failure = error;
  }

  async allowedLocationIds(): Promise<PolicyDecision> {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    return structuredClone(this.decision);
  }
}
