# HTTP endpoint handler layer — pure modules + wiring protocol

> **STAGING NOTE (integration lane, INT-C2-1 item b — mirrors the cycle-1
> `src/platform/contracts/` staging pattern).** The workflow shell reserves the
> repository root and the unified-CLI project layout, so the file-based
> endpoint adapters (`src/pages/api/*`) do not exist yet: they are created by
> the authenticated scaffold (gate T-VP0, human-owned prerequisites per
> Contract §16). This directory therefore holds the COMPLETE handler logic as
> pure, Wix-import-free modules plus this binding wiring protocol. Whoever
> writes the thin adapters at scaffold time MUST follow it verbatim.

## 1. Why every endpoint verifies tokens (binding platform fact)

Technical Contract §6, verbatim facts:

- **"HTTP endpoints have NO built-in permissions model — reachable by anyone
  who knows its URL."**
- Every endpoint must verify the caller token via `auth.getTokenInfo()` from
  `@wix/essentials`; dashboard frontends call through
  `httpClient.fetchWithAuth()`, which attaches the caller token.

Consequence baked into this layer: every handler begins with
`requireVerifiedCaller(deps, request)` and fails CLOSED with a typed error on
missing, invalid or expired tokens BEFORE any store/gateway is consulted
(zero-store-mutation is test-enforced).

## 2. Endpoint map

| Method + path (scaffold) | Handler | Body / query | Success body | Failure codes |
|---|---|---|---|---|
| GET `/api/ruleset` | `getActiveRuleSet` | — | `{ ruleSet: RuleSetDTO \| null }` | auth |
| PUT `/api/ruleset` | `putRuleSet` | `{ ruleSet, expectedRevision }` | `{ ruleSet: RuleSetDTO, savedBy }` | auth, INVALID_QUERY (shape/seam), REVISION_CONFLICT |
| POST `/api/apply-plan` | `postApplyPlan` | exactly `{ confirmedDiffHash }` | `{ summary: MutationSummary, requestedBy }` | auth, INVALID_QUERY, NOT_FOUND (unknown hash), orchestrator codes |
| GET `/api/mutation-status?planId=` | `getMutationStatus` | query `planId` | `{ status: MutationStatusProjection }` | auth, INVALID_QUERY, NOT_FOUND |
| POST `/api/recover` | `postRecover` | `{ scope }` | `{ recovery: RecoverySummary \| null }` | auth, INVALID_QUERY |

All response DTOs compose canonical `src/shared/types.ts` primitives
(`RuleSetDTO`, `MutationRecordState`, `ScheduleScope`, `Instant`, ...);
`MutationSummary` / `RecoverySummary` come from the accepted schedule-mutation
orchestrator. Failures carry typed codes from the shared taxonomy
(`src/shared/errors.ts`) mapped to HTTP statuses by `httpResponseForError`.

## 3. Thin adapter protocol (execute at scaffold time)

For each row above, create `src/pages/api/<name>.ts` inside the scaffolded
unified-CLI project. The adapter owns ALL platform mechanics; the handler owns
all product logic:

1. **Extract the caller token** from the platform request context using the
   current `@wix/essentials` guidance for HTTP endpoints (`auth.getTokenInfo()`
   seam; frontends send via `httpClient.fetchWithAuth()`). Capture the exact
   working extraction as T-VP0 evidence — do not guess API shapes before the
   scaffold exists.
2. **Parse** the JSON body (when the method has one) and query parameters.
3. **Build** an `EndpointRequest { authToken, body, query }`.
4. **Invoke** the pure handler from this barrel inside try/catch.
5. **Serialize**: success → `HttpResponse.status` + JSON body;
   failure → `httpResponseForError(caught)` → same shape.

Sketch (illustrative only — exact request/response helper names are T-VP0
evidence, not fabricated here):

```ts
// src/pages/api/ruleset.ts  (FUTURE scaffold file)
import { getActiveRuleSet, putRuleSet, httpResponseForError } from '.../platform/http';
// adapter: extract token -> parse body -> EndpointRequest -> handler ->
// serialize HttpResponse | httpResponseForError(error)
```

The production `TokenVerifier` adapter wraps `auth.getTokenInfo()` and returns
null for missing/invalid/expired tokens (port contract in
`../tokenVerifier.ts`). Until that adapter exists, tests inject fakes only.

## 4. Executed one-line amendment for `src/shared/errors.ts` (Director)

The canonical ErrorCode union previously had no auth-specific member, so auth
rejections carried code `INVALID_QUERY` PLUS the dedicated
`UnauthorizedRequestError` class with a structured `details.reason`
(`TOKEN_MISSING` | `TOKEN_INVALID` | `TOKEN_VERIFIER_FAILED`) — branch on the
class, never on the code string.

The staged additive amendment was EXECUTED by the Director at integration of
run 32787032785 (additive `| 'UNAUTHORIZED'` to `ErrorCode`,
`super('UNAUTHORIZED', ...)` in `UnauthorizedRequestError`, `UNAUTHORIZED: 401`
in the transport status map; helper assertions updated). Mechanical,
non-discretionary, exactly like the cycle-1 contract relocations. No existing
member changed semantics; `INVALID_QUERY` remains 400 for shape errors.

## 5. Scope discipline (audit-facing)

- No business-rule logic: endpoints validate SHAPE + REVISION only. Temporal/
  policy semantics enter exclusively via the optional `domainValidation` seam
  (`RuleSetValidationSeam`) once the Rules lane reaches ACCEPT.
- apply-plan executes ONLY user-confirmed diffs referenced by hash (Contract
  §9.2); inline plans are rejected by strict body schema.
- Purity gate: no `@wix/` imports anywhere under `src/platform/http/**`
  (enforced by `npm run check:purity` since cycle 2).
