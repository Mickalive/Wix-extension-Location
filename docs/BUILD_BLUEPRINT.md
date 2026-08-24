# Build Blueprint

Status: **BLOCKED UNTIL RECON DIRECTOR VALIDATES WIX ARCHITECTURE**

The recon director must replace this placeholder before product construction begins.

Required separation:
- `src/platform/**`: Wix-specific adapters and safe mutation/persistence integration.
- `src/domain/**`: pure deterministic rule engine with no Wix imports.
- `src/extensions/dashboard/**` and `src/ui/**`: Wix dashboard configuration UX.
- `src/billing/**`: plan/location-count entitlements.
- `tests/**`: corresponding deterministic tests.

The final blueprint must define concrete interfaces between these modules, supported Wix extension registrations, data persistence, location counting, error model, rollback/idempotency policy and test strategy.
