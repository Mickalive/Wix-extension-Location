#!/usr/bin/env bash

set -euo pipefail

repository="${GITHUB_REPOSITORY:?}"
workflow="${WIX_LOOP_WORKFLOW:?WIX_LOOP_WORKFLOW is required}"
tracking_issue="${WIX_TRACKING_ISSUE:-1}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

runs=$(gh run list --repo "$repository" --workflow "$workflow" --limit 30 \
  --json databaseId,status,conclusion,createdAt,url)

active_count=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
if (( active_count > 0 )); then
  active_url=$(jq -r '[.[] | select(.status != "completed")] | sort_by(.createdAt) | last | .url' <<<"$runs")
  {
    echo "### Wix Ox watchdog"
    echo
    echo "Workflow $workflow already active: $active_url"
  } >>"$summary_file"
  exit 0
fi

latest=$(jq -c '[.[] | select(.status == "completed")] | sort_by(.createdAt) | last // empty' <<<"$runs")
if [[ -z "$latest" ]]; then
  echo "No completed $workflow run to inspect." >>"$summary_file"
  exit 0
fi

run_id=$(jq -r '.databaseId' <<<"$latest")
run_url=$(jq -r '.url' <<<"$latest")
conclusion=$(jq -r '.conclusion' <<<"$latest")
if [[ "$conclusion" != failure ]]; then
  {
    echo "### Wix Ox watchdog"
    echo
    echo "Latest $workflow run does not require recovery: $run_url ($conclusion)."
  } >>"$summary_file"
  exit 0
fi

jobs=$(gh api "repos/$repository/actions/runs/$run_id/jobs?filter=latest&per_page=100")
failed_jobs=$(jq -c '[.jobs[] | select(.conclusion == "failure")]' <<<"$jobs")
failed_count=$(jq 'length' <<<"$failed_jobs")
if (( failed_count == 0 )); then
  echo "::warning::Run $run_id is failed but exposes no failed jobs."
  exit 0
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
transient_jobs=()
dependent_jobs=()
unsafe_jobs=()

while IFS= read -r encoded_job; do
  job=$(printf '%s' "$encoded_job" | base64 -d)
  job_id=$(jq -r '.id' <<<"$job")
  job_name=$(jq -r '.name' <<<"$job")
  log_file="$tmp_dir/$job_id.log"

  if ! gh run view "$run_id" --repo "$repository" --job "$job_id" --log >"$log_file" 2>&1; then
    unsafe_jobs+=("$job_name (logs unavailable)")
    continue
  fi

  if grep -Fq 'WIX_OPENCODE_FAILURE_KIND=permanent' "$log_file"; then
    unsafe_jobs+=("$job_name")
  elif grep -Fq 'WIX_OPENCODE_FAILURE_KIND=transient' "$log_file"; then
    transient_jobs+=("$job_name")
  elif grep -Eqi \
       'network_error|network error|temporarily unavailable|connection (reset|closed)|ECONNRESET|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)' \
       "$log_file" &&
       grep -Eqi 'OpenCode .* unavailable after [0-9]+ attempts|OpenCode .* remains unavailable after [0-9]+ attempts' "$log_file"; then
    transient_jobs+=("$job_name (legacy retry marker)")
  elif grep -Eqi \
       "couldn't find remote ref cycle/wix-(recon|build)/|candidate branch found=false|candidate_found=false|missing candidate snapshot|missing research snapshot" \
       "$log_file"; then
    dependent_jobs+=("$job_name")
  else
    unsafe_jobs+=("$job_name")
  fi
done < <(jq -r '.[] | @base64' <<<"$failed_jobs")

# A downstream audit/director may fail only because a transiently failed upstream
# agent never produced its candidate branch. That dependent failure must not block
# recovery of the root OX outage. GitHub's rerun-failed-jobs endpoint will replay
# both the transient root job and its failed dependents in the same run attempt.
if (( ${#transient_jobs[@]} == 0 || ${#unsafe_jobs[@]} > 0 )); then
  {
    echo "### Wix Ox watchdog"
    echo
    echo "No automatic recovery for $run_url."
    echo
    echo "- transient Ox failures: ${#transient_jobs[@]}"
    echo "- downstream dependent failures: ${#dependent_jobs[@]}"
    echo "- non-transient/unclassified failures: ${#unsafe_jobs[@]}"
  } >>"$summary_file"
  exit 0
fi

old_attempt=$(gh api "repos/$repository/actions/runs/$run_id" --jq '.run_attempt')
gh api --method POST "repos/$repository/actions/runs/$run_id/rerun-failed-jobs" >/dev/null

new_attempt=$((old_attempt + 1))
confirmed=false
for _ in {1..15}; do
  state=$(gh api "repos/$repository/actions/runs/$run_id" --jq '[.status, .run_attempt] | @tsv')
  IFS=$'\t' read -r status observed_attempt <<<"$state"
  if [[ "$status" != completed || "$observed_attempt" -gt "$old_attempt" ]]; then
    new_attempt="$observed_attempt"
    confirmed=true
    break
  fi
  sleep 2
done

if [[ "$confirmed" != true ]]; then
  echo "::warning::GitHub accepted recovery for run $run_id but the new attempt is not observable yet."
fi

transient_list=$(IFS=', '; echo "${transient_jobs[*]}")
dependent_list=$(IFS=', '; echo "${dependent_jobs[*]:-}")
{
  echo "### Wix Ox watchdog"
  echo
  echo "Automatic transient-Ox recovery triggered: $run_url"
  echo
  echo "- GitHub attempt: $old_attempt -> $new_attempt"
  echo "- transient root jobs: $transient_list"
  echo "- downstream jobs replayed: ${dependent_list:-none}"
} >>"$summary_file"

body=$(printf '### Automatic recovery after transient OX outage\n\n- Workflow: `%s`\n- Run: [%s](%s)\n- GitHub attempt: `%s -> %s`\n- Transient root jobs: %s\n- Downstream dependent jobs: %s\n\nThe same autonomous cycle is being resumed. Successful jobs and already-persisted candidate snapshots are preserved. Downstream jobs are replayed only because their required transiently-failed snapshot was missing; no unrelated non-transient code failure was restarted.' \
  "$workflow" "$run_id" "$run_url" "$old_attempt" "$new_attempt" "$transient_list" "${dependent_list:-none}")

printf '%s\n' "$body" || \
  echo "::warning::Recovery started, but status issue comment failed."
