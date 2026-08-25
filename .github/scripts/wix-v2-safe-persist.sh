#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?}" "${BASE_SHA:?}" "${GATE:?}" "${PLAN_DECISION:?}" "${STALLED:?}" "${CYCLE_INDEX:?}" "${LANE_BRANCH:?}" "${GITHUB_RUN_ID:?}"
decision="$PLAN_DECISION"
[[ "$GATE" == failed ]] && decision=continue
[[ "$STALLED" == true ]] && decision=stalled
if [[ "$GATE" == failed ]]; then
  rm -rf /tmp/wix-cycle-evidence && mkdir -p /tmp/wix-cycle-evidence
  for path in docs/NEXT_CYCLE.json docs/NEXT_CYCLE.md docs/PRODUCT_GATES.json docs/LOOP_HEALTH.json; do
    if [[ -f "$path" ]]; then mkdir -p "/tmp/wix-cycle-evidence/$(dirname "$path")"; cp "$path" "/tmp/wix-cycle-evidence/$path"; fi
  done
  for dir in reports/director reports/audits reports/integration; do
    if [[ -d "$dir" ]]; then mkdir -p "/tmp/wix-cycle-evidence/$dir"; cp -a "$dir"/. "/tmp/wix-cycle-evidence/$dir/"; fi
  done
  git reset --hard "$BASE_SHA"
  git clean -fd
  cp -a /tmp/wix-cycle-evidence/. .
fi
jq --argjson c "$CYCLE_INDEX" --arg r "$GITHUB_RUN_ID" --arg d "$decision" '.cycle=$c|.last_accepted_run=$r|.release_candidate=($d=="release_candidate")' docs/state.json > /tmp/state.json
mv /tmp/state.json docs/state.json
git config user.name wix-deterministic-director
git config user.email wix-deterministic-director@users.noreply.github.com
git add docs/NEXT_CYCLE.json docs/NEXT_CYCLE.md docs/PRODUCT_GATES.json docs/LOOP_HEALTH.json docs/state.json reports/director reports/audits reports/integration
if [[ "$GATE" == passed ]]; then msg="accept audited cycle state"; else msg="preserve rejected cycle evidence"; fi
git commit --allow-empty -m "Wix build $GITHUB_RUN_ID: $msg"
auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
remote=$(git -c "http.extraheader=AUTHORIZATION: basic $auth" ls-remote origin "refs/heads/$LANE_BRANCH" | awk '{print $1}')
test "$remote" = "$BASE_SHA"
git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$LANE_BRANCH"
{
  echo "decision=$decision"
  echo "gate=$GATE"
} >> "${GITHUB_OUTPUT:?}"
