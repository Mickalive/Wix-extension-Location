# Integration Lane Audit — Candidate SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** lane-auditor (independent, read-only except this report)
- **Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1` (current HEAD, working tree clean)
- **Candidate:** same SHA — the integration candidate is the accepted base itself
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/INTEGRATION.md`, `AGENTS.md`
- **Scope:** verify Wix-owned scaffold/binding came from authenticated official generation; reproduce evidence and tests

---

## 1. Scaffold/binding evidence — reproduced

### 1.1 Real `wix.config.json` (gitignored, present in working tree)
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
- File exists at repo root, is **gitignored** (`.gitignore` line 19: `wix.config.json` with rationale comment referencing Contract §16 and runbook).
- Contains a valid UUID `appId` matching the `BOOTSTRAP_BINDING.md` live-QA evidence: "GitHub Actions authenticated with the protected Wix API key and bound the product to the explicitly selected existing Wix app **Advanced Booking Rules** (App ID: 3e9ec3af-001b-4684-a197-a5133677844d). No app was created by this run. Wix generated a real wix.config.json for that exact app and a real `wix build` completed successfully before the binding was persisted."

### 1.2 Committed shape template `wix.config.example.json`
```json
{
  "projectType": "app",
  "appId": "<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"
}
```
- Committed, byte-for-byte pinned by `serializeExampleProjectConfig()` in `exampleProjectConfig.ts` (test-enforced).
- Classifier `classifyProjectBinding()` correctly returns `UNLINKED` with explicit placeholder problem — **never** `LINKED`.

### 1.3 Classifier behavior verified (registration-project-config.spec.ts: 13 tests pass)
| Input | Classification | Reason |
|-------|----------------|--------|
| Missing file | `MISSING_FILE` | File not found |
| Invalid JSON | `UNPARSEABLE` | Parse error |
| Non-object JSON | `UNPARSEABLE` | Must be top-level object |
| Example template (placeholder appId) | `UNLINKED` | `appId` holds scaffold placeholder |
| Real config (valid UUID appId) | `LINKED` | Positive evidence of non-placeholder `appId` |
| Empty/non-string appId | `UNLINKED` | Type/emptiness problem |
| Unknown extra fields | Tolerated (preserved) | Schema-drift discipline (Contract §11 C4 analog) |

**Key property:** `LINKED` demands a non-empty, non-placeholder string `appId`. The classifier **cannot over-report linkage** — it can only under-report (safe direction).

### 1.4 `extensions.ts` — intentionally empty anchor
```ts
export const EXTENSIONS: readonly GeneratedExtensionEntry[] = Object.freeze([]);
```
- Documented as CLI-owned anchor; zero entries because zero extensions exist until the authenticated scaffold generates them (INT-C6-R1, Technical Contract §15/§16).
- Included in `tsconfig.json` via `include` (additive, no drift).

### 1.5 Registration surface modules (`src/platform/registration/**`)
- **Pure modules** (no `@wix/` imports — purity gate passes over this root).
- `extensionsManifest.ts`: 8 planned entries, each with contract-exact channel (`UNIFIED_CLI_GENERATE`, `APP_DASHBOARD_FALLBACK`, `INTERACTIVE_CLI_MENU`, `FILE_BASED_NO_REGISTRATION`), status `PLANNED_UNTIL_T_VP0`, and existing `productSourcePath` anchors (ghost-path existence test-enforced).
- `validationExtension.ts`: `buildBookingsValidationExtensionConfig()` derives `validationTargets` from `VALIDATION_TARGETS` (single source of truth — handler matrix), throws `PlatformError('INVALID_STATE')` on malformed `deploymentUri` (never silent coercion).
- `projectConfig.ts` / `exampleProjectConfig.ts`: classifier + template, anti-fabrication by design.
- `scaffoldPrerequisites.ts`: machine-readable record of 5 human-owned prerequisites (Contract §16), each with owner=`HUMAN_ACCOUNT_OWNER`, gate, runbook anchor; `externalBlockerStatement()` composes narrow BLOCKED_EXTERNAL wording.

---

## 2. Deterministic checks — reproduced

| Check | Command | Result |
|-------|---------|--------|
| Purity gate | `npm run check:purity` | **PASS** — no `@wix/` imports under 7 protected roots (including new `src/platform/registration`) |
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| Unit tests | `npm run test:unit` (vitest) | **548/548 PASS** (49 test files) |
| Offline tests | `npm run check:offline` | **548/548 PASS** — zero network egress |
| Build | `npm run build` (equals `check`) | **PASS** |
| Dashboard UI tests | `npm test` in `tests/ui` | **210/210 PASS** (identical to prior cycle) |

**Arithmetic verification:** Prior accepted cycle had 518 tests. This cycle adds 17 (`registration-surface`) + 13 (`registration-project-config`) = 30 new tests. 518 + 30 = 548 exact — no test lost or duplicated.

---

## 3. Anti-fabrication verification

- **No secrets, no fabricated identifiers:** The real `wix.config.json` is gitignored; the committed template carries only explicit placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`. Anti-fabrication specs sweep the whole surface for UUID-like/hex shapes and SDK-import strings — **passing** (only RFC-2606 `.invalid`/`.example` hosts and clearly-named test fixtures appear).
- **`DEFAULT_VALIDATION_DEPLOYMENT_URI = '/api/bookings-validation'`** is a project-internal route per documented `pages/api` mapping (recon §3/§4.2, source S9), not an account identifier.
- **Status honesty:** Every inventory row in `extensionsManifest.ts` is `PLANNED_UNTIL_T_VP0`; README §4 makes no registration/live-behavior claims; `externalBlockerStatement()` composes the narrow, identifier-free BLOCKED_EXTERNAL wording grounded in Contract §16/T-VP0/runbook — precisely what the live-QA criterion requires, without pre-empting or faking the live job's own disposition.

---

## 4. Scope & lane ownership

Every changed path sits in the integration lane's assigned surface:
- `wix.config.json` / `wix.config.example.json` / `.gitignore` / `tsconfig.json` / `extensions.ts` — scaffold-surface files (integration fiche explicitly owns non-secret project registration metadata).
- `src/platform/registration/**` — pure classifier/inventory modules (integration-owned).
- `tests/platform/registration-*.spec.ts` — integration tests.

No feature creep, no unrelated refactors, no PREVIEW_GATED dependencies, no production claims. Empirical gates T-VP*/T-WH*/T-BK*/T-RB* remain open and unbypassed; `docs/PRODUCT_GATES.json` honestly keeps `real_wix_scaffold_registration` OPEN.

---

## 5. Cross-lane compatibility

- Zero diff on `src/shared/**`, `src/domain/**`, `src/billing/**`, `src/ui/**`, `src/extensions/**`, `src/platform/{schedule-mutation,webhooks,adapters,http,validation-plugin,composition}/**`.
- Nothing outside `src/platform/registration/**` imports the new surface (grep-verified).
- Single-source-of-truth welding: `buildBookingsValidationExtensionConfig()` derives `validationTargets` from `VALIDATION_TARGETS` (implemented handler matrix) — registered surface cannot drift from enforced surface; test-enforced equality + length-6 canonical-order pin.

---

## 6. Non-blocking observations (record only)

1. **O1:** `registration-surface.spec.ts` matches `/wix\.config\.example\.json/m` against `.gitignore`, hitting a comment line rather than the active rule. Harmless (example file is meant to be committable; load-bearing `^wix\.config\.json$` anchor is correct).
2. **O2:** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal (e.g. `/api/%2e%2e/x`). Value is self-authored at scaffold time, not attacker input; minimal exposure.
3. **O3:** Two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect.
4. **O4:** Placeholder token matching can flag an exotic real appId containing e.g. `TODO` as UNLINKED — false positive in the safe direction; acceptable.

---

## 7. Verdict

The candidate honestly establishes every derivable element of the supported unified-CLI scaffold/registration surface, fabricates nothing, strengthens gates (purity root added), keeps all accepted behavior intact (548/548 tests, 210/210 UI, typecheck, build, offline), and converts the live-QA blocker into precisely the narrow, evidenced external prerequisite that governance permits.

**Reproduced evidence confirms:** the real `wix.config.json` with a valid appId exists in the working tree (gitignored per policy), the committed template is provably UNLINKED, the classifier cannot fabricate linkage, and the BOOTSTRAP_BINDING.md live-QA record documents authenticated Wix CLI generation. No hand-authored guesses are present in the committed artifact set.

VERDICT: ACCEPT