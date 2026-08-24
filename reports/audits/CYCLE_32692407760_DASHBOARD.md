# Persisted recovery audit — DASHBOARD, cycle 32692407760

Original independent verdict: `FIX_BEFORE_INTEGRATION`.

Mandatory blockers to repair before new feature work:

1. Diff preview misrepresents exception mutations and violates the binding informed-consent requirement. `UPDATE_EXCEPTION` must show before → after details, including CLOSED/OVERRIDE state and hours; `REMOVE_EXCEPTION` must show the removed entry's kind/hours. Add tests proving the rendered lines expose those details.
2. Review/confirm is reachable while the draft is invalid. Either disable “Review changes” while validation issues exist, or disable Confirm inside the modal and show the blocking issues. Add a negative UI test proving invalid content cannot become confirmed through the UI.

Required integration/next-cycle obligation: replace the dashboard lane's temporary duplicated validators with the canonical domain validators once the accepted Rules implementation exists, using the existing repoint seam, and add a cross-lane parity test for exact message equality.

Non-blocking hardening recorded by the auditor: restore focus on modal close or correct the comment; delete `src/ui/probe.txt`; avoid silent Save/Apply controls before backend wiring; map malformed 2xx JSON to typed BridgeError; rename `zzDebug.test.js`; surface unknown weekday keys instead of silently dropping them.

The auditor otherwise verified 63/63 component tests, coverage of all v1 editor rule types, accessibility, hash-bound confirmation gating, no scattered Wix imports, deterministic diff behavior, and honest Wix/platform copy.

Source of truth remains immutable branch `cycle/wix-build/32692407760/audit-dashboard`.

VERDICT: FIX_BEFORE_INTEGRATION
