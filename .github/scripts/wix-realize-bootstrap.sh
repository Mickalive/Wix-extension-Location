#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}"
: "${PRODUCT_BRANCH:?}" "${EXPECTED_WIX_APP_ID:?}" "${WIX_CLI_VERSION:?}" "${GH_TOKEN:?}" "${WIX_API_KEY:?}"

STATE="$GITHUB_WORKSPACE/.factory/state.json"
ROOT="$RUNNER_TEMP/wix-realize-$GITHUB_RUN_ID"
PRODUCT="$ROOT/product"
PRODUCT_REF="refs/remotes/origin/$PRODUCT_BRANCH"
mkdir -p "$ROOT" "$GITHUB_WORKSPACE/.factory/evidence"

auth(){ printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0; }
remote_main(){ git -C "$GITHUB_WORKSPACE" ls-remote origin refs/heads/main | awk '{print $1}'; }
cleanup(){ git -C "$GITHUB_WORKSPACE" worktree remove --force "$PRODUCT" >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT

[[ "$(remote_main)" == "$GITHUB_SHA" ]] || { echo "::error::stale control SHA"; exit 2; }
jq -e '.phase=="BUILD" and .lane=="integration" and ((.repair_feedback // "") | startswith("REAL_WIX_EXTENSIONS_REQUIRED:"))' "$STATE" >/dev/null \
  || { echo "Not the real-Wix bootstrap state; nothing to do."; exit 0; }

accepted="$(jq -r '.accepted_base' "$STATE")"
base="$(jq -r '.candidate.sha // .accepted_base' "$STATE")"
generation="$(jq -r '.generation' "$STATE")"

git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" fetch --prune --tags origin "+refs/heads/$PRODUCT_BRANCH:$PRODUCT_REF" >/dev/null
[[ "$(git -C "$GITHUB_WORKSPACE" rev-parse "$PRODUCT_REF")" == "$accepted" ]] || { echo "::error::accepted product drift"; exit 3; }
git -C "$GITHUB_WORKSPACE" worktree add --detach "$PRODUCT" "$base" >/dev/null

bash "$GITHUB_WORKSPACE/.github/scripts/wix-generate-real-extensions.sh" "$PRODUCT" "$ROOT/generate"

# Generated output is authoritative even though it is intentionally not yet a
# complete product: the next dashboard/integration repairs wire real runtime
# code into these exact CLI-owned files. Never throw away Wix-generated UUIDs.
git -C "$PRODUCT" config user.name wix-official-generate
git -C "$PRODUCT" config user.email wix-official-generate@users.noreply.github.com
git -C "$PRODUCT" add -A
if git -C "$PRODUCT" diff --cached --quiet; then
  echo "::error::Official generation produced no product diff"
  exit 4
fi
git -C "$PRODUCT" commit -m "candidate(integration): real Wix extensions generation $generation" >/dev/null
candidate="$(git -C "$PRODUCT" rev-parse HEAD)"
tag="refs/tags/factory-candidate/integration/$generation"
git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin "$candidate:$tag" >/dev/null

# Keep the generated candidate as the cumulative base. Dashboard now ports the
# test-only UiDocument UI into the generated React page/modal shells. This is a
# product repair, not a fresh rebuild from accepted_base.
tmp="$ROOT/state.json"
jq \
  --arg sha "$candidate" \
  --arg tag "$tag" \
  --arg base "$base" \
  --argjson run "$GITHUB_RUN_ID" \
  '.candidate={sha:$sha,tag:$tag,base:$base,lane:"integration"}
   |.phase="BUILD"
   |.lane="dashboard"
   |.generation+=1
   |.repair_feedback="REAL_REACT_DASHBOARD_REQUIRED: Wix CLI has generated real dashboard page/modal builders and UUIDs on the cumulative candidate. Port the Advanced Booking Rules editor, Locations Usage page and diff-confirm flow into those generated React/TSX surfaces using @wix/dashboard/@wix/design-system and the typed services bridge. The generated extensions must be genuinely usable in Wix; do not mount or wrap the test-only UiDocument/UiNode runtime. Preserve every Wix-generated extension ID and all non-dashboard generated files."
   |.gate_proofs={}
   |.last_transition={reason:"real_wix_extensions_generated",run_id:$run}
   |.last_run=$run
   |.last_operational_failure=null
   |.lease=null
   |.blocked_resume_phase=null' "$STATE" >"$tmp"
mv "$tmp" "$STATE"

git -C "$GITHUB_WORKSPACE" config user.name wix-factory-control
git -C "$GITHUB_WORKSPACE" config user.email wix-factory-control@users.noreply.github.com
git -C "$GITHUB_WORKSPACE" add .factory
git -C "$GITHUB_WORKSPACE" commit -m "factory: generated real Wix extensions run $GITHUB_RUN_ID" >/dev/null
[[ "$(remote_main)" == "$GITHUB_SHA" ]] || { echo "::error::control plane moved; refusing stale state push"; exit 5; }
git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin HEAD:refs/heads/main >/dev/null

echo "REAL_WIX_BOOTSTRAP_CANDIDATE=$candidate"
