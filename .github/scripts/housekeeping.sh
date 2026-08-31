#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:?}"
token="${GH_TOKEN:?}"
current_run="${GITHUB_RUN_ID:?}"
current_sha="${GITHUB_SHA:?}"
auth="$(printf 'x-access-token:%s' "$token" | base64 -w0)"
candidate_keep="$(jq -r '.candidate.tag // empty' .factory/state.json)"

remote_main(){ git ls-remote origin refs/heads/main | awk '{print $1}'; }

# A stale run is never allowed to perform housekeeping. This prevents an older
# queued workflow from cancelling the newer authoritative run that superseded it.
latest_main="$(remote_main)"
if [[ "$current_sha" != "$latest_main" ]]; then
  echo "Stale run $current_run on $current_sha; main is $latest_main. Skipping housekeeping."
  exit 0
fi

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

for pass in 1 2 3; do
  # If main moved while housekeeping was running, stop immediately. The new SHA
  # owns all subsequent cleanup decisions.
  latest_main="$(remote_main)"
  [[ "$current_sha" == "$latest_main" ]] || {
    echo "Main advanced to $latest_main during housekeeping; stopping cleanup."
    exit 0
  }

  runs="$(gh api "repos/$repo/actions/runs?per_page=100&page=1")"
  mapfile -t obsolete < <(
    jq -r --arg current "$current_run" --arg sha "$current_sha" '
      .workflow_runs[]
      | select(.name=="Wix Product Factory")
      | select((.id|tostring)!=$current and .head_sha!=$sha)
      | [.id,.status,.run_number,.head_sha]
      | @tsv
    ' <<<"$runs"
  )
  (( ${#obsolete[@]} > 0 )) || break

  changed=false
  for row in "${obsolete[@]}"; do
    IFS=$'\t' read -r run_id status run_number run_sha <<<"$row"
    [[ -n "$run_id" ]] || continue

    latest_main="$(remote_main)"
    [[ "$current_sha" == "$latest_main" ]] || {
      echo "Main advanced during cleanup; preserving newer runs."
      exit 0
    }
    [[ "$run_sha" != "$latest_main" ]] || continue

    if [[ "$status" != completed ]]; then
      gh api -X POST "repos/$repo/actions/runs/$run_id/force-cancel" >/dev/null 2>&1 \
        || gh api -X POST "repos/$repo/actions/runs/$run_id/cancel" >/dev/null 2>&1 \
        || true
    fi
    if gh api -X DELETE "repos/$repo/actions/runs/$run_id" >/dev/null 2>&1; then
      echo "Deleted obsolete Factory run $run_id (#$run_number, $status, $run_sha)."
      changed=true
    else
      echo "::warning::GitHub retained obsolete Factory run $run_id (#$run_number, $status)."
    fi
  done
  [[ "$changed" == true ]] || break
done
