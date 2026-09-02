#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}" "${EXPECTED_WIX_APP_ID:?}" "${WIX_CLI_VERSION:?}"
STATE="$GITHUB_WORKSPACE/.factory/state.json"
PRODUCT="${1:?product worktree required}"
SHA="${2:?candidate sha required}"
OUT="$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_release_deterministic.json"
mkdir -p "$(dirname "$OUT")"

fail(){
  local reason="$1"
  jq -n --arg sha "$SHA" --arg reason "$reason" --argjson run "$GITHUB_RUN_ID" \
    '{schemaVersion:2,gate:"RELEASE_AUDIT",mode:"deterministic-independent",sha:$sha,runId:$run,verdict:"NOT_READY",reason:$reason}' >"$OUT"
  echo "::error::Release auditor NOT_READY: $reason"
  exit 10
}

[[ -f "$STATE" ]] || fail "missing canonical state"
[[ -f "$PRODUCT/wix.config.json" ]] || fail "missing wix.config.json"
jq -e --arg id "$EXPECTED_WIX_APP_ID" '.appId==$id and (.projectId|type=="string" and length>0) and (.projectType|type=="string" and length>0)' "$PRODUCT/wix.config.json" >/dev/null || fail "Wix binding mismatch"

# HARD PRODUCT-REALITY GATE. A compiling core, a valid Wix shell or a successful
# Bookings API probe is not a finished app. READY requires real CLI/API-created
# extensions, actual React dashboard runtime, real Astro endpoint adapters,
# data collections and an authenticated Bookings Validation registration.
RUNTIME_LOG="$RUNNER_TEMP/runtime-readiness-$GITHUB_RUN_ID.log"
set +e
bash "$GITHUB_WORKSPACE/.github/scripts/wix-runtime-readiness.sh" "$PRODUCT" >"$RUNTIME_LOG" 2>&1
runtime_rc=$?
set -e
if (( runtime_rc != 0 )); then
  reason="$(tail -n1 "$RUNTIME_LOG" | sed -E 's/^.*REAL_WIX_RUNTIME_NOT_READY:[[:space:]]*//' | tail -c 4000)"
  [[ -n "$reason" ]] || reason="real Wix runtime/registration gate failed"
  cat "$RUNTIME_LOG" >&2 || true
  fail "$reason"
fi

lane_sha="$(jq -r '.gate_proofs.lane.sha // empty' "$STATE")"
integrated_sha="$(jq -r '.gate_proofs.integrated.sha // empty' "$STATE")"
wix_sha="$(jq -r '.gate_proofs.wix.sha // empty' "$STATE")"
[[ "$lane_sha" == "$SHA" ]] || fail "lane proof does not target candidate SHA"
[[ "$integrated_sha" == "$SHA" ]] || fail "integrated proof does not target candidate SHA"
[[ "$wix_sha" == "$SHA" ]] || fail "Wix live proof does not target candidate SHA"
[[ "$(jq -r '.repair_feedback // empty' "$STATE")" == "" ]] || fail "unresolved repair feedback"

wix_run="$(jq -r '.gate_proofs.wix.run_id // empty' "$STATE")"
[[ -n "$wix_run" ]] || fail "missing Wix live proof run id"
live="$GITHUB_WORKSPACE/.factory/evidence/run_${wix_run}_wix_live_deterministic.json"
[[ -f "$live" ]] || fail "missing deterministic Wix live evidence"
jq -e --arg sha "$SHA" '.sha==$sha and .verdict=="ACCEPT" and .bookingsApi.status==200 and .wixBuild=="PASS" and .deterministicChecks=="PASS" and .runtimeRegistration=="PASS"' "$live" >/dev/null || fail "Wix live evidence is incomplete, lacks runtime registration proof, or does not target candidate SHA"

CHECK_LOG="$RUNNER_TEMP/release-check-$GITHUB_RUN_ID.log"
BUILD_LOG="$RUNNER_TEMP/release-build-$GITHUB_RUN_ID.log"
set +e
(cd "$PRODUCT" && npm ci --ignore-scripts --no-audit --no-fund && npm run check) >"$CHECK_LOG" 2>&1
check_rc=$?
set -e
(( check_rc == 0 )) || { tail -n80 "$CHECK_LOG" >&2; fail "fresh deterministic release checks failed"; }

set +e
(cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" build) >"$BUILD_LOG" 2>&1
build_rc=$?
set -e
(( build_rc == 0 )) || { tail -n80 "$BUILD_LOG" >&2; fail "fresh Wix release build failed"; }

jq -n \
  --arg sha "$SHA" \
  --arg app "$EXPECTED_WIX_APP_ID" \
  --argjson run "$GITHUB_RUN_ID" \
  '{schemaVersion:2,gate:"RELEASE_AUDIT",mode:"deterministic-independent",sha:$sha,runId:$run,appId:$app,deterministicChecks:"PASS",wixBuild:"PASS",runtimeRegistration:"PASS",proofs:{lane:"ACCEPT",integrated:"ACCEPT",wixLive:"ACCEPT"},verdict:"READY"}' >"$OUT"

echo "RELEASE AUDITOR: READY for $SHA"
