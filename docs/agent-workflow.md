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

Each lane has a separate auditor working from the untouched accepted state plus a mounted candidate worktree. Audit reports are persisted separately.

The build director mounts all candidate and audit snapshots, integrates only accepted work into the current checkout of `lab/wix-rules`, runs deterministic checks, and updates `docs/NEXT_CYCLE.md`.

## Safety / quality gates

- Main prompt hash is checked before every autonomous job.
- Candidate path scopes are enforced by workflow shell.
- Candidate agents cannot alter orchestration or governance.
- Missing audit means no integration for that lane.
- Failed deterministic checks reject the integrated cycle and preserve the previous accepted commit.
- Developer Preview Wix features remain disabled unless the technical contract explicitly reclassifies them based on current official docs.
- Release and Marketplace submission are never automated without explicit human-owned Wix credentials and readiness.

## Looping

After a successful accepted cycle, the trusted workflow reads the director decision. `continue` dispatches the next build cycle. `stop` or `release_candidate` ends the loop and reports the exact status to issue #1.
