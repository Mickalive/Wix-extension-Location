/**
 * TEST-ONLY fault type simulating abrupt process death mid-apply (gate T-RB1).
 *
 * The orchestrator intentionally does NOT catch this: a real crash bypasses all
 * in-process handling. The durable journal record stays APPLY_IN_PROGRESS and
 * `recoverInterruptedApply` restores the exact pre-apply state from the
 * persisted snapshot on the next run.
 */
export class SimulatedProcessCrash extends Error {
  readonly planId: string;
  readonly changeIndex: number;
  readonly changeId: string;

  constructor(planId: string, changeIndex: number, changeId: string) {
    super(
      `SIMULATED process crash during apply of plan ${planId} at change index ${changeIndex} (${changeId})`,
    );
    this.name = 'SimulatedProcessCrash';
    this.planId = planId;
    this.changeIndex = changeIndex;
    this.changeId = changeId;
  }
}
