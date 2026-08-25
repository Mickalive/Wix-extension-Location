#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?}" "${BASE_SHA:?}" "${GITHUB_RUN_ID:?}"
branch="cycle/wix-build/${GITHUB_RUN_ID}/preview"
auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git config user.name wix-deterministic-integrator
git config user.email wix-deterministic-integrator@users.noreply.github.com
git switch -C "$branch" "$BASE_SHA"
mkdir -p reports/audits reports/integration
manifest=$(mktemp)
printf '{"run_id":"%s","accepted_base":"%s","lanes":{}}\n' "$GITHUB_RUN_ID" "$BASE_SHA" > "$manifest"
accepted_changes=0
negative=()
for role in integration rules dashboard billing; do
  cbranch="cycle/wix-build/${GITHUB_RUN_ID}/${role}"
  abranch="cycle/wix-build/${GITHUB_RUN_ID}/audit-${role}"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin \
    "$cbranch:refs/remotes/origin/$cbranch" "$abranch:refs/remotes/origin/$abranch"
  csha=$(git rev-parse "origin/$cbranch")
  asha=$(git rev-parse "origin/$abranch")
  test "$(git rev-parse "$csha^")" = "$BASE_SHA"
  test "$(git rev-parse "$asha^")" = "$BASE_SHA"
  upper=${role^^}
  report="reports/audits/CYCLE_${GITHUB_RUN_ID}_${upper}.md"
  git show "${asha}:${report}" > "$report"
  verdict=$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')
  [[ "$verdict" == ACCEPT || "$verdict" == FIX_BEFORE_INTEGRATION || "$verdict" == REJECT ]]
  changed=false
  if ! git diff --quiet "$BASE_SHA" "$csha"; then changed=true; fi
  if [[ "$verdict" == ACCEPT && "$changed" == true ]]; then
    git cherry-pick "$csha"
    accepted_changes=$((accepted_changes + 1))
  elif [[ "$verdict" != ACCEPT ]]; then
    negative+=("$role")
  fi
  tmp=$(mktemp)
  jq --arg role "$role" --arg candidate "$csha" --arg audit "$asha" --arg verdict "$verdict" --argjson changed "$changed" \
    '.lanes[$role]={candidate_sha:$candidate,audit_sha:$audit,verdict:$verdict,has_product_diff:$changed}' "$manifest" > "$tmp"
  mv "$tmp" "$manifest"
done
cp "$manifest" "reports/integration/CYCLE_${GITHUB_RUN_ID}_MANIFEST.json"
git add reports/audits reports/integration
git commit --allow-empty -m "Wix build $GITHUB_RUN_ID: audited integration manifest"
preview_sha=$(git rev-parse HEAD)
git -c "http.extraheader=AUTHORIZATION: basic $auth" push --force origin "HEAD:refs/heads/$branch"
printf -v joined '%s,' "${negative[@]:-}"
{
  echo "preview_sha=$preview_sha"
  echo "accepted_changes=$accepted_changes"
  echo "negative_lanes=${joined%,}"
} >> "${GITHUB_OUTPUT:?}"
