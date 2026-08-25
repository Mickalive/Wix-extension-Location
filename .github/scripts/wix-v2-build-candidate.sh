#!/usr/bin/env bash
set -euo pipefail
: "${ROLE:?}" "${STATUS:?}" "${BASE_SHA:?}" "${GH_TOKEN:?}" "${MAIN_PROMPT_SHA256:?}"
test "$(git rev-parse HEAD)" = "$BASE_SHA"
printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | sha256sum --check --strict
if [[ "$STATUS" == active ]]; then
  : "${AGENT:?}" "${DIRECTIVE:?}" "${CYCLE_INDEX:?}"
  task=$(jq -r --arg r "$ROLE" '.lanes[$r].task' docs/NEXT_CYCLE.json)
  why=$(jq -r --arg r "$ROLE" '.lanes[$r].why_needed' docs/NEXT_CYCLE.json)
  evidence=$(jq -c --arg r "$ROLE" '.lanes[$r].source_evidence' docs/NEXT_CYCLE.json)
  criteria=$(jq -c --arg r "$ROLE" '.lanes[$r].acceptance_criteria' docs/NEXT_CYCLE.json)
  bash .github/scripts/run-opencode-with-retry.sh opencode run --model "$OX_MODEL" --agent "$AGENT" "Run Wix product lane $ROLE, cycle $CYCLE_INDEX, from immutable accepted SHA $BASE_SHA. Read MAIN_PROMPT.md, AGENTS.md, docs/WIX_TECHNICAL_CONTRACT.md, docs/BUILD_BLUEPRINT.md, $DIRECTIVE, docs/NEXT_CYCLE.json and latest persisted audit. Exact task: $task. Why: $why. Evidence: $evidence. Criteria: $criteria. Repair current negative-audit blockers before unrelated work. Otherwise do ONLY this task. Do not alter orchestration, governance, job descriptions, other lanes, or commit/push. Human note: ${HUMAN_NOTE:-}"
  unexpected=0
  while IFS= read -r -d '' path; do
    ok=0
    case "$ROLE:$path" in
      integration:package.json|integration:package-lock.json|integration:tsconfig.json|integration:astro.config.mjs|integration:extensions.ts|integration:wix.config.example.json|integration:.gitignore|integration:vite.config.*|integration:vitest.config.*|integration:eslint.config.*|integration:src/env.d.ts|integration:src/platform/*|integration:src/platform/**|integration:src/extensions/backend/*|integration:src/extensions/backend/**|integration:tests/platform/*|integration:tests/platform/**) ok=1 ;;
      rules:src/domain/*|rules:src/domain/**|rules:tests/domain/*|rules:tests/domain/**) ok=1 ;;
      dashboard:src/extensions/dashboard/*|dashboard:src/extensions/dashboard/**|dashboard:src/ui/*|dashboard:src/ui/**|dashboard:tests/ui/*|dashboard:tests/ui/**) ok=1 ;;
      billing:src/billing/*|billing:src/billing/**|billing:tests/billing/*|billing:tests/billing/**) ok=1 ;;
    esac
    (( ok == 1 )) || { echo "::error::Unexpected $ROLE path: $path"; unexpected=1; }
  done < <({ git diff --name-only -z; git diff --cached --name-only -z; git ls-files --others --exclude-standard -z; })
  test "$unexpected" -eq 0
else
  git diff --quiet
  test -z "$(git ls-files --others --exclude-standard)"
fi
printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | sha256sum --check --strict
branch="cycle/wix-build/${GITHUB_RUN_ID}/${ROLE}"
git config user.name "wix-$ROLE-builder"
git config user.email "wix-$ROLE-builder@users.noreply.github.com"
git switch -C "$branch" "$BASE_SHA"
[[ "$STATUS" == active ]] && git add -A || true
git commit --allow-empty -m "Wix build $GITHUB_RUN_ID: $ROLE candidate ($STATUS)"
test "$(git rev-parse HEAD^)" = "$BASE_SHA"
auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git -c "http.extraheader=AUTHORIZATION: basic $auth" push --force origin "HEAD:refs/heads/$branch"
