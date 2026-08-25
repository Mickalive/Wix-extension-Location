#!/usr/bin/env bash

set -euo pipefail

repository="${GITHUB_REPOSITORY:?}"
workflow="${WIX_LOOP_WORKFLOW:?WIX_LOOP_WORKFLOW is required}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

runs=$(gh run list --repo "$repository" --workflow "$workflow" --limit 30 \
  --json databaseId,status,conclusion,createdAt,url)

active_count=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
if (( active_count > 0 )); then
  active_url=$(jq -r '[.[] | select(.status != "completed")] | sort_by(.createdAt) | last | .url' <<<"$runs")
  {
    echo "### Wix autonomous recovery"
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
    echo "### Wix autonomous recovery"
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
infra_jobs=()
dependent_jobs=()
unsafe_jobs=()

while IFS= read -r encoded_job; do
  job=$(printf '%s' "$encoded_job" | base64 -d)
  job_id=$(jq -r '.id' <<<"$job")
  job_name=$(jq -r '.name' <<<"$job")
  step_count=$(jq '(.steps // []) | length' <<<"$job")
  log_file="$tmp_dir/$job_id.log"

  if ! gh run view "$run_id" --repo "$repository" --job "$job_id" --log >"$log_file" 2>&1; then
    if (( step_count == 0 )); then
      infra_jobs+=("$job_name (runner/bootstrap failure)")
    else
      unsafe_jobs+=("$job_name (logs unavailable after steps started)")
    fi
    continue
  fi

  if grep -Fq 'WIX_OPENCODE_FAILURE_KIND=transient' "$log_file"; then
    transient_jobs+=("$job_name")
  elif grep -Eqi \
       'endpoint is unavailable|upstream request failed|service unavailable|provider unavailable' \
       "$log_file"; then
    # Older attempts may have incorrectly emitted the permanent marker for these
    # provider-side failures. The concrete upstream-unavailability signature wins.
    transient_jobs+=("$job_name (provider unavailable)")
  elif grep -Fq 'WIX_OPENCODE_FAILURE_KIND=permanent' "$log_file"; then
    unsafe_jobs+=("$job_name")
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

recoverable_root_count=$(( ${#transient_jobs[@]} + ${#infra_jobs[@]} ))
if (( recoverable_root_count == 0 || ${#unsafe_jobs[@]} > 0 )); then
  {
    echo "### Wix autonomous recovery"
    echo
    echo "No automatic recovery for $run_url."
    echo
    echo "- transient OX failures: ${#transient_jobs[@]}"
    echo "- runner/bootstrap failures: ${#infra_jobs[@]}"
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

transient_list=$(IFS=', '; echo "${transient_jobs[*]:-}")
infra_list=$(IFS=', '; echo "${infra_jobs[*]:-}")
dependent_list=$(IFS=', '; echo "${dependent_jobs[*]:-}")
{
  echo "### Wix autonomous recovery"
  echo
  echo "Automatic recovery triggered: $run_url"
  echo
  echo "- GitHub attempt: $old_attempt -> $new_attempt"
  echo "- transient OX root jobs: ${transient_list:-none}"
  echo "- runner/bootstrap root jobs: ${infra_list:-none}"
  echo "- downstream jobs replayed: ${dependent_list:-none}"
} >>"$summary_file"

printf 'Automatic recovery: workflow=%s run=%s attempt=%s->%s OX=%s infra=%s dependent=%s\n' \
  "$workflow" "$run_id" "$old_attempt" "$new_attempt" \
  "${transient_list:-none}" "${infra_list:-none}" "${dependent_list:-none}"
