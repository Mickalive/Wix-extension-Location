#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}"
: "${PRODUCT_BRANCH:?}" "${EXPECTED_WIX_APP_ID:?}" "${WIX_CLI_VERSION:?}" "${GH_TOKEN:?}" "${WIX_API_KEY:?}"
STATE="$GITHUB_WORKSPACE/.factory/state.json"
ROOT="$RUNNER_TEMP/wix-final-$GITHUB_RUN_ID"
PRODUCT="$ROOT/product"
mkdir -p "$ROOT" "$GITHUB_WORKSPACE/.factory/evidence"

auth(){ printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0; }
remote_main(){ git -C "$GITHUB_WORKSPACE" ls-remote origin refs/heads/main | awk '{print $1}'; }
persist(){
  git -C "$GITHUB_WORKSPACE" config user.name wix-factory-control
  git -C "$GITHUB_WORKSPACE" config user.email wix-factory-control@users.noreply.github.com
  git -C "$GITHUB_WORKSPACE" add .factory
  git -C "$GITHUB_WORKSPACE" commit -m "factory: READY generation $(jq -r '.generation' "$STATE") run $GITHUB_RUN_ID" >/dev/null
  [[ "$(remote_main)" == "$GITHUB_SHA" ]] || { echo "::error::control plane moved; refusing stale final push"; exit 1; }
  git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin HEAD:refs/heads/main >/dev/null
}
cleanup(){ git -C "$GITHUB_WORKSPACE" worktree remove --force "$PRODUCT" >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT

phase="$(jq -r '.phase' "$STATE")"
effective="$phase"
[[ "$phase" == BLOCKED_EXTERNAL ]] && effective="$(jq -r '.blocked_resume_phase // empty' "$STATE")"
case "$effective" in WIX_QA|RELEASE_AUDIT) ;; *) echo "Not a deterministic final gate: $effective"; exit 0;; esac
sha="$(jq -r '.candidate.sha // .accepted_base' "$STATE")"
accepted="$(jq -r '.accepted_base' "$STATE")"
tag="$(jq -r '.candidate.tag // empty' "$STATE")"
rm -rf "$PRODUCT"
git -C "$GITHUB_WORKSPACE" worktree add --detach "$PRODUCT" "$sha" >/dev/null

if [[ "$effective" == WIX_QA ]]; then
  [[ -n "${WIX_SITE_ID:-}" && -n "${WIX_CLIENT_ID:-}" ]] || { echo "::error::Wix preflight identifiers missing"; exit 41; }
  [[ -f "$PRODUCT/wix.config.json" ]] || { echo "::error::missing wix.config.json"; exit 42; }
  jq -e --arg id "$EXPECTED_WIX_APP_ID" '.appId==$id' "$PRODUCT/wix.config.json" >/dev/null || { echo "::error::wrong Wix app binding"; exit 42; }

  CHECK_LOG="$ROOT/check.log"; BUILD_LOG="$ROOT/build.log"; DEV_LOG="$ROOT/dev-site.log"; API_BODY="$ROOT/bookings.json"
  (cd "$PRODUCT" && npm ci --ignore-scripts --no-audit --no-fund && npm run check) >"$CHECK_LOG" 2>&1 || { tail -n80 "$CHECK_LOG" >&2; exit 43; }
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" build) >"$BUILD_LOG" 2>&1 || { tail -n80 "$BUILD_LOG" >&2; exit 44; }
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site list) >"$DEV_LOG" 2>&1 || { tail -n80 "$DEV_LOG" >&2; exit 45; }

  set +e
  status="$(curl -sS --retry 3 --retry-all-errors --connect-timeout 10 --max-time 30 \
    -o "$API_BODY" -w '%{http_code}' \
    -X POST 'https://www.wixapis.com/_api/bookings/v2/services/query' \
    -H "Authorization: $WIX_API_KEY" \
    -H "wix-site-id: $WIX_SITE_ID" \
    -H 'Content-Type: application/json' \
    --data '{"query":{"paging":{"limit":1}}}')"
  curl_rc=$?
  set -e
  (( curl_rc == 0 )) || { echo "::error::Wix Bookings live probe transport failed"; exit 46; }
  [[ "$status" == 200 ]] || { echo "::error::Wix Bookings live probe returned HTTP $status"; head -c 2000 "$API_BODY" >&2 || true; exit 47; }
  jq -e 'type=="object"' "$API_BODY" >/dev/null || { echo "::error::Wix Bookings live probe returned non-JSON body"; exit 48; }

  live="$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_live_deterministic.json"
  jq -n --arg sha "$sha" --arg site "$WIX_SITE_ID" --arg client "$WIX_CLIENT_ID" --argjson run "$GITHUB_RUN_ID" \
    '{schemaVersion:1,gate:"WIX_QA",mode:"deterministic-readonly-api",sha:$sha,runId:$run,siteId:$site,clientId:$client,deterministicChecks:"PASS",wixBuild:"PASS",devSite:"PASS",bookingsApi:{endpoint:"/_api/bookings/v2/services/query",method:"POST",status:200,readOnly:true},verdict:"ACCEPT"}' >"$live"

  tmp="$ROOT/state-wix.json"
  jq --arg sha "$sha" --argjson run "$GITHUB_RUN_ID" \
    '.phase="RELEASE_AUDIT"|.generation+=1|.blocked_resume_phase=null|.last_operational_failure=null|.repair_feedback=null|.gate_proofs.wix={sha:$sha,run_id:$run,verdict:"ACCEPT",mode:"deterministic-readonly-api"}|.last_transition={reason:"wix_live_accept_deterministic",run_id:$run}|.last_run=$run|.lease=null' \
    "$STATE" >"$tmp" && mv "$tmp" "$STATE"
  effective=RELEASE_AUDIT
fi

set +e
bash "$GITHUB_WORKSPACE/.github/scripts/release-readiness-auditor.sh" "$PRODUCT" "$sha"
audit_rc=$?
set -e
if (( audit_rc != 0 )); then
  report="$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_release_deterministic.json"
  reason="$(jq -r '.reason // "deterministic release audit failed"' "$report" 2>/dev/null || echo 'deterministic release audit failed')"
  tmp="$ROOT/state-not-ready.json"
  jq --arg reason "$reason" --argjson run "$GITHUB_RUN_ID" '.phase="PLAN"|.generation+=1|.repair_feedback=$reason|.last_transition={reason:"final_release_not_ready",run_id:$run}|.last_run=$run|.lease=null|.blocked_resume_phase=null' "$STATE" >"$tmp" && mv "$tmp" "$STATE"
  persist
  exit 0
fi

jq -e --arg sha "$sha" '.sha==$sha and .verdict=="READY"' "$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_release_deterministic.json" >/dev/null

git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" fetch --prune origin "+refs/heads/$PRODUCT_BRANCH:refs/remotes/origin/$PRODUCT_BRANCH" >/dev/null
remote="$(git -C "$GITHUB_WORKSPACE" rev-parse "refs/remotes/origin/$PRODUCT_BRANCH")"
[[ "$remote" == "$accepted" ]] || { echo "::error::accepted product branch moved"; exit 49; }
if [[ "$sha" != "$accepted" ]]; then
  git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin "$sha:refs/heads/$PRODUCT_BRANCH" >/dev/null
fi
if [[ -n "$tag" ]]; then
  git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin ":$tag" >/dev/null 2>&1 || true
fi

tmp="$ROOT/state-ready.json"
jq --arg sha "$sha" --argjson run "$GITHUB_RUN_ID" '.accepted_base=$sha|.candidate=null|.repair_feedback=null|.gate_proofs={}|.phase="READY"|.generation+=1|.last_transition={reason:"final_release_ready_deterministic",run_id:$run}|.last_run=$run|.last_operational_failure=null|.lease=null|.blocked_resume_phase=null' "$STATE" >"$tmp" && mv "$tmp" "$STATE"
persist

echo "FACTORY READY: $sha"
