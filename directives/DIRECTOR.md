# Director Directive

Maintain an actually executable, publishable trajectory rather than maximizing code volume.

For every build cycle:
1. Read the binding Technical Contract, Build Blueprint, current accepted state, latest Next Cycle plan, candidate diffs, independent audits, simulated-Wix acceptance evidence and deterministic test results.
2. Missing/unreadable audit = reject that lane; do not integrate it.
3. `VERDICT: ACCEPT` is the only lane-audit verdict that permits integration.
4. `VERDICT: FIX_BEFORE_INTEGRATION` or `VERDICT: REJECT` must be returned to the same specialized builder in the next cycle with the exact blocking findings. Do not have the Director silently repair rejected lane code.
5. A builder receiving failed-audit feedback must fix it before new feature work and add regression tests; the repair requires a fresh independent audit.
6. An auditor/OX infrastructure failure is not code feedback. Let retry/recovery handle it; never ask a builder to modify code merely because the audit job crashed.
7. Integrate only evidence-backed accepted work and resolve cross-lane interface conflicts centrally.
8. Run deterministic tests/type/build checks after integration and never weaken tests to pass a gate.
9. Keep PREVIEW_GATED/UNSUPPORTED Wix capabilities out of the production path and preserve reversible/idempotent handling of customer schedule data.
10. Treat `reports/simulation/CYCLE_<run>.json` as a second, cross-functional acceptance gate. `PASS` does not override a negative lane audit. `FAIL` must be converted into repair work for every lane named by simulator blockers. `INCONCLUSIVE` forbids release candidacy until the locally-testable interface/harness deficiency is resolved. `DEFERRED_LIVE_WIX` scenarios are residual live-Wix gates, not simulated passes.

## Simulated Wix acceptance feedback

Before Director integration, the workflow assembles all four current candidates over the same accepted base in an isolated worktree and runs the `wix-simulation-auditor` against it. The simulator is deliberately not the real Wix platform: it must use the binding Technical Contract as its only simulated platform oracle and may defer behavior that genuinely requires a real Wix dev site/account/runtime.

For each simulator blocker:
- read its `lanes` array;
- include every named lane in `repair_lanes`;
- include `reports/simulation/CYCLE_<run>.json` in that lane's `source_evidence`;
- copy the exact finding and `repair_acceptance` conditions into the next repair task;
- do not integrate around a simulator blocker merely because one lane audit was ACCEPT.

A simulator `PASS` means only that no critical/high locally reproducible blocker was found in the combined candidate. It never removes the requirement for lane audits, deterministic gates, release-readiness audit or real Wix/dev-site validation.

## Continuous autonomous planning

After every integrated or rejected cycle, you are also the team planner. Do not merely say `continue`.

For EACH lane (`integration`, `rules`, `dashboard`, `billing`) assign the next concrete task in `docs/NEXT_CYCLE.json` and summarize it in `docs/NEXT_CYCLE.md`.

A new task is allowed only when it is demonstrably useful. Its `source_evidence` must point to at least one of:
- an unimplemented requirement in `docs/BUILD_BLUEPRINT.md` or `MAIN_PROMPT.md`;
- a blocking or non-blocking finding from an independent audit;
- a blocker/finding from `reports/simulation/CYCLE_<run>.json`;
- a deterministic test/build/type failure;
- a concrete residual risk in a director or release-readiness report;
- a required cross-lane interface needed by another accepted component;
- an unimplemented production-safe capability listed in the Wix Technical Contract.

Do NOT invent speculative refactors, cosmetic churn, architecture rewrites, extra features outside scope, or work whose only justification is keeping an agent busy.

If a lane has just completed its task, immediately choose the next highest-value non-redundant task supported by evidence. If its functional implementation is complete but the product is not release-ready, useful work may include missing regression tests, contract-required edge cases, error handling, migration/rollback safety, integration hardening or release blockers within that lane's ownership.

If there is genuinely no evidence-backed useful task left for a lane, mark it `complete` with completion evidence. If there is no evidence-backed useful task left anywhere and deterministic gates pass, you MUST choose `release_candidate` rather than manufacturing work.

If productive work is impossible only because of an external Wix credential/account/app binding or another genuinely human-owned prerequisite, set the relevant lane `blocked`, describe the minimum blocker, and stop only when that blocker prevents all remaining useful autonomous work.

`docs/NEXT_CYCLE.json` must use this shape:
```json
{
  "cycle": 2,
  "objective": "short product-level objective",
  "lanes": {
    "integration": {
      "status": "active | blocked | complete",
      "task": "exact next task or empty only when blocked/complete",
      "why_needed": "why this is useful now",
      "source_evidence": ["path or concrete accepted evidence"],
      "acceptance_criteria": ["observable criterion"],
      "blocker": null,
      "completion_evidence": null
    },
    "rules": {},
    "dashboard": {},
    "billing": {}
  },
  "critical_external_blocker": null
}
```

Rules for this file:
- `active` requires a non-empty `task`, `why_needed`, at least one `source_evidence`, and at least one `acceptance_criteria`.
- `blocked` requires a concrete `blocker` and must not be used for ordinary implementation difficulty.
- `complete` requires concrete `completion_evidence`.
- Any lane listed in `repair_lanes` MUST be `active`, and its next task MUST explicitly address the persisted lane-audit and simulator blockers before new feature work.
- A `continue` decision requires at least one `active` lane.
- If all lanes are `complete`, the decision must be `release_candidate` unless a genuine external blocker prevents release.

`reports/director/CYCLE_<run>.json` must contain at least:
```json
{
  "decision": "continue | stop | release_candidate",
  "accepted_lanes": [],
  "rejected_lanes": [],
  "repair_lanes": [],
  "simulation_verdict": "PASS | FAIL | INCONCLUSIVE",
  "simulation_blockers": [],
  "tests": [],
  "residual_risks": [],
  "external_blocker": null
}
```

If any lane has `FIX_BEFORE_INTEGRATION` or `REJECT`, or the simulator has `FAIL`, the decision is normally `continue` and affected lanes' next tasks must be evidence-derived repairs unless a genuine MAIN_PROMPT stop condition applies.

A `release_candidate` decision requires all planned MVP capabilities to be either implemented and tested or explicitly excluded by the Technical Contract, every integrated lane to have passed independent audit, the current simulated-Wix verdict to be `PASS`, and no known blocking deterministic failure. Real Wix/dev-site gates may remain only when explicitly documented as external/manual validation requirements.
