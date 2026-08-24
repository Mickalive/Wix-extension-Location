/**
 * In-memory fake {@link RulesConfigStore} (Blueprint §3; Contract §8.2).
 * Mirrors the binding revision-checked save semantics: a stale
 * `expectedRevision` rejects with REVISION_CONFLICT.
 */
import { PlatformError } from '../../contracts';
import type { RuleSet, RulesConfigStore } from '../../contracts';

export interface FakeRulesConfigStoreOptions {
  initialRuleSet?: RuleSet | null;
  /** Injected timestamp source for revision bookkeeping (defaults to a counter). */
  now?: () => Date;
}

export class FakeRulesConfigStore implements RulesConfigStore {
  private active: RuleSet | null;
  private revisionCounter = 1;

  constructor(options: FakeRulesConfigStoreOptions = {}) {
    this.active = options.initialRuleSet ? structuredClone(options.initialRuleSet) : null;
  }

  async loadActiveRuleSet(): Promise<RuleSet | null> {
    return this.active ? structuredClone(this.active) : null;
  }

  async saveRuleSet(next: RuleSet, expectedRevision: string): Promise<RuleSet> {
    if (!this.active) {
      throw new PlatformError('INVALID_STATE', 'no active rule set to update; seed the store first', {
        details: { ruleSetId: next.ruleSetId },
      });
    }
    if (this.active.revision !== expectedRevision) {
      throw new PlatformError(
        'REVISION_CONFLICT',
        `expected revision ${expectedRevision}, current ${this.active.revision}`,
        { retriable: true, details: { ruleSetId: next.ruleSetId } },
      );
    }
    this.revisionCounter += 1;
    const saved: RuleSet = { ...structuredClone(next), revision: `rev-${this.revisionCounter}` };
    this.active = saved;
    return structuredClone(saved);
  }

  /** Test helper: replace the stored set without revision checks. */
  setActive(ruleSet: RuleSet | null): void {
    this.active = ruleSet ? structuredClone(ruleSet) : null;
  }
}
