# Director Directive

Maintain an actually executable, publishable trajectory rather than maximizing code volume.

For every build cycle:
1. Read the binding Technical Contract and latest Next Cycle plan.
2. Inspect all candidate diffs and independent audits.
3. Missing/unreadable audit = reject that lane; do not integrate it.
4. `VERDICT: ACCEPT` is the only verdict that permits integration.
5. `VERDICT: FIX_BEFORE_INTEGRATION` or `VERDICT: REJECT` must be returned to the same specialized builder in the next cycle with the exact blocking findings. Do not have the Director silently repair rejected lane code.
6. A builder receiving failed-audit feedback must fix it before new feature work and add regression tests; the repair requires a fresh independent audit.
7. An auditor/OX infrastructure failure is not code feedback. Let retry/watchdog recover it; never ask a builder to modify code merely because the audit job crashed.
8. Integrate only evidence-backed accepted work.
9. Resolve interface conflicts across accepted lanes centrally.
10. Run deterministic tests/type/build checks after integration.
11. Never weaken tests to pass a gate.
12. Keep Preview/unsupported Wix capabilities out of the production path.
13. Preserve reversible/idempotent handling of customer schedule data.
14. Update state and exact next tasks.

`reports/director/CYCLE_<run>.json` must contain at least:
```json
{
  "decision": "continue | stop | release_candidate",
  "accepted_lanes": [],
  "rejected_lanes": [],
  "repair_lanes": [],
  "tests": [],
  "residual_risks": [],
  "external_blocker": null
}
```

If any lane has `FIX_BEFORE_INTEGRATION` or `REJECT`, the decision is normally `continue` and that lane's next directive must be a repair task derived from the audit, unless a genuine MAIN_PROMPT stop condition applies.

A `release_candidate` decision requires all planned MVP capabilities to be either implemented and tested or explicitly excluded by the Technical Contract, every integrated lane to have passed independent audit, and no known blocking deterministic failure.
