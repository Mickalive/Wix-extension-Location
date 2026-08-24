# Autonomous workflow

## Persistent state

`lab/wix-rules` is the only accepted autonomous-development branch. Every candidate starts from that branch. Candidate branches are disposable evidence, not accepted state.

## Stage 1: reconnaissance

Three independent researchers investigate current Wix capabilities from official sources. They write only under `reports/recon/`.

An independent recon auditor reviews their claims and sources and writes `reports/audits/RECON_*.md`.

The recon director reads the untouched accepted branch plus complete researcher snapshots and the audit. It may update only the technical contract, build blueprint, next-cycle instructions, state, and director reports. It advances `docs/state.json.phase` to `build` only if the publishable architecture is sufficiently proven.

## Stage 2: build cycles

Four product lanes run from the same accepted commit:
- integration
- rules
- dashboard
- billing

Each lane gets its own candidate branch. No candidate may commit or push itself; trusted workflow shell persists snapshots.

Each lane has a separate auditor working from the untouched accepted state plus a mounted candidate worktree. Audit reports are persisted separately and must end with exactly `VERDICT: ACCEPT`, `VERDICT: FIX_BEFORE_INTEGRATION`, or `VERDICT: REJECT`.

Only `ACCEPT` permits integration. A negative audit verdict is a feedback event, not a dead end: the Director preserves the findings in accepted evidence and assigns them back to the same specialized builder for the next autonomous cycle. That builder fixes the blocking findings first, adds regression tests, and the resulting repair receives a fresh independent audit. `REJECT` means rebuild from accepted state rather than blindly patching the rejected candidate.

An audit job that fails because OX/network/provider infrastructure is unavailable is not code feedback. Retry/watchdog handles that failure and the affected lane remains non-integrable until a real audit exists.

The build director mounts all candidate and audit snapshots, integrates only `ACCEPT` work into the current checkout of `lab/wix-rules`, runs deterministic checks, and updates `docs/NEXT_CYCLE.md`.

## Safety / quality gates

- `MAIN_PROMPT.md` is the immutable product constitution and its SHA-256 is checked by the autonomous workflows.
- Candidate path scopes are enforced by workflow shell.
- Candidate agents cannot alter `MAIN_PROMPT.md`, orchestration, agent definitions, retry/recovery infrastructure, or governance.
- Missing audit means no integration for that lane.
- `FIX_BEFORE_INTEGRATION` or `REJECT` means no integration and mandatory same-lane repair before new feature work.
- Failed deterministic checks reject the integrated cycle and preserve the previous accepted commit.
- Developer Preview Wix features remain disabled unless the technical contract explicitly reclassifies them based on current official docs.
- Release and Marketplace submission are never automated without explicit human-owned Wix credentials and readiness.

## Ox provider resilience

Provider/network outages are infrastructure failures, not product failures.

Every OpenCode/OX invocation uses the same trusted retry script on `main` and `lab/wix-rules`:
- up to 6 attempts inside one job;
- 300 seconds fixed between attempts after a classified transient provider/network failure;
- immediate stop on a non-transient failure;
- exhausted transient retries exit with an explicit `WIX_OPENCODE_FAILURE_KIND=transient` marker.

Six attempts are only a per-job-pass limit. They are not a global abandonment limit.

`Wix Autonomous Launch Bridge` runs a watchdog on a nominal five-minute schedule. The watchdog:
- detects the current persistent phase (`recon` or `build`);
- does nothing while the relevant autonomous workflow is already active;
- inspects the latest failed run only for that current phase;
- reads failed-job logs and restarts only when every failed job is classified as a transient OX/provider outage;
- never automatically restarts non-transient, code, test, architecture, billing, or platform-contract failures;
- re-runs only failed jobs in the same GitHub run, preserving successful jobs and already-persisted candidate/audit snapshots;
- may repeat on later watchdog passes with no repository-defined global retry ceiling until OX recovers or a real non-transient failure occurs.

The watchdog also understands the legacy retry marker from the initial Wix recon run, so a transient provider failure produced by the old 3-attempt policy can still be recovered and resumed under the new retry policy.

## Looping

After a successful accepted cycle, the trusted workflow reads the director decision. `continue` dispatches the next build cycle, including mandatory same-lane audit repairs when present. `stop` or `release_candidate` ends the loop and reports the exact status to issue #1.

A transient OX outage is never by itself a valid reason for the autonomous product effort to stop permanently.
