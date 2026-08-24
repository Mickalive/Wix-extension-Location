# Director Directive

Maintain an actually executable, publishable trajectory rather than maximizing code volume.

For every build cycle:
1. Read the binding Technical Contract and latest Next Cycle plan.
2. Inspect all candidate diffs and independent audits.
3. Missing audit = reject that lane.
4. Integrate only evidence-backed work.
5. Resolve interface conflicts across lanes centrally.
6. Run deterministic tests/type/build checks after integration.
7. Never weaken tests to pass a gate.
8. Keep Preview/unsupported Wix capabilities out of the production path.
9. Preserve reversible/idempotent handling of customer schedule data.
10. Update state and exact next tasks.

`reports/director/CYCLE_<run>.json` must contain at least:
```json
{
  "decision": "continue | stop | release_candidate",
  "accepted_lanes": [],
  "rejected_lanes": [],
  "tests": [],
  "residual_risks": [],
  "external_blocker": null
}
```

A `release_candidate` decision requires all planned MVP capabilities to be either implemented and tested or explicitly excluded by the Technical Contract, with no known blocking deterministic failure.
