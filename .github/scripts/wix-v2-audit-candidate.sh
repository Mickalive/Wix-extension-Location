#!/usr/bin/env bash
set -euo pipefail
: "${ROLE:?}" "${STATUS:?}" "${BASE_SHA:?}" "${CANDIDATE_SHA:?}" "${GH_TOKEN:?}"
upper=${ROLE^^}
report="reports/audits/CYCLE_${GITHUB_RUN_ID}_${upper}.md"
if [[ "$STATUS" == active ]]; then
  : "${DIRECTIVE:?}" "${CYCLE_INDEX:?}"
  bash .github/scripts/run-opencode-with-retry.sh opencode run --model "$OX_MODEL" --agent lane-auditor "Audit Wix $ROLE candidate cycle $CYCLE_INDEX. Immutable candidate SHA $CANDIDATE_SHA is mounted at /tmp/wix_${ROLE}_candidate; current checkout is exact accepted SHA $BASE_SHA. Read $DIRECTIVE, docs/NEXT_CYCLE.json and binding contracts. Inspect the exact diff and acceptance criteria. Write only $report ending exactly VERDICT: ACCEPT, VERDICT: FIX_BEFORE_INTEGRATION, or VERDICT: REJECT."
else
  git diff --quiet "$BASE_SHA" "$CANDIDATE_SHA"
  mkdir -p reports/audits
  printf '# %s lane — deterministic no-op audit\n\nQueue status: **%s**. Candidate has no product diff from accepted SHA.\n\nVERDICT: ACCEPT\n' "$ROLE" "$STATUS" > "$report"
fi
tail -n 1 "$report" | grep -Eq '^VERDICT: (ACCEPT|FIX_BEFORE_INTEGRATION|REJECT)$'
unexpected=0
while IFS= read -r -d '' path; do
  [[ "$path" == "$report" ]] || { echo "::error::Unexpected audit edit: $path"; unexpected=1; }
done < <({ git diff --name-only -z; git diff --cached --name-only -z; git ls-files --others --exclude-standard -z; })
test "$unexpected" -eq 0
branch="cycle/wix-build/${GITHUB_RUN_ID}/audit-${ROLE}"
git config user.name "wix-$ROLE-auditor"
git config user.email "wix-$ROLE-auditor@users.noreply.github.com"
git switch -C "$branch" "$BASE_SHA"
git add "$report"
git commit --allow-empty -m "Wix build $GITHUB_RUN_ID: $ROLE audit"
test "$(git rev-parse HEAD^)" = "$BASE_SHA"
auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git -c "http.extraheader=AUTHORIZATION: basic $auth" push --force origin "HEAD:refs/heads/$branch"
