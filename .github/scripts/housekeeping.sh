#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:?}"
token="${GH_TOKEN:?}"
current_run="${GITHUB_RUN_ID:?}"
current_sha="${GITHUB_SHA:?}"
auth="$(printf 'x-access-token:%s' "$token" | base64 -w0)"
candidate_keep="$(jq -r '.candidate.tag // empty' .factory/state.json)"

while IFS= read -r ref; do
  case "$ref" in
    refs/heads/cycle/*|refs/heads/recovery/*)
      git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin ":$ref" >/dev/null 2>&1 || true
      ;;
  esac
done < <(git ls-remote --heads origin | awk '{print $2}')

while IFS= read -r ref; do
  [[ -n "$ref" ]] || continue
  if [[ "$ref" == refs/tags/factory-candidate/* && "$ref" != "$candidate_keep" ]]; then
    git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin ":$ref" >/dev/null 2>&1 || true
  fi
done < <(git ls-remote --refs origin 'refs/tags/factory-candidate/*' | awk '{print $2}')

for pass in 1 2 3 4 5; do
  runs="$(gh api "repos/$repo/actions/runs?per_page=100&page=1")"
  mapfile -t obsolete < <(
    jq -r --arg current "$current_run" --arg sha "$current_sha" '
      .workflow_runs[]
      | select((.id|tostring)!=$current and .head_sha!=$sha)
      | [.id,.status,.run_number,.name]
      | @tsv
    ' <<<"$runs"
  )
  (( ${#obsolete[@]} > 0 )) || break
  deleted_any=false
  for row in "${obsolete[@]}"; do
    IFS=$'\t' read -r run_id status run_number name <<<"$row"
    [[ -n "$run_id" ]] || continue
    if [[ "$status" != completed ]]; then
      gh api -X POST "repos/$repo/actions/runs/$run_id/force-cancel" >/dev/null 2>&1 \
        || gh api -X POST "repos/$repo/actions/runs/$run_id/cancel" >/dev/null 2>&1 \
        || true
    fi
    if gh api -X DELETE "repos/$repo/actions/runs/$run_id" >/dev/null 2>&1; then
      echo "Deleted obsolete Actions run $run_id (#$run_number, $name, $status)."
      deleted_any=true
    else
      echo "::warning::GitHub retained obsolete Actions run $run_id (#$run_number, $status)."
    fi
  done
  [[ "$deleted_any" == true ]] || break
done
