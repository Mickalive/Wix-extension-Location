#!/usr/bin/env bash

set -euo pipefail

repository="${GITHUB_REPOSITORY:?}"
workflow="${WIX_LOOP_WORKFLOW:?WIX_LOOP_WORKFLOW is required}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

# Long-lived supervisors can overlap briefly during a handoff or workflow update.
# Only the newest watchdog run is allowed to mutate Factory state; older supervisors
# become read-only/no-op as soon as they refresh this script from main.
if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
  latest_watchdog=$(gh run list --repo "$repository" --workflow wix-watchdog.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0' 2>/dev/null || echo 0)
  if [[ "$latest_watchdog" =~ ^[0-9]+$ ]] && (( latest_watchdog > 0 )) && [[ "$GITHUB_RUN_ID" != "$latest_watchdog" ]]; then
    echo "Supervisor run $GITHUB_RUN_ID is superseded by watchdog $latest_watchdog; no mutation this tick." >>"$summary_file"
    exit 0
  fi
fi

runs=$(gh run list --repo "$repository" --workflow "$workflow" --limit 30 \
  --json databaseId,status,conclusion,createdAt,url)

active_count=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
if (( active_count > 0 )); then
  active_url=$(jq -r '[.[] | select(.status != "completed")] | sort_by(.createdAt) | last | .url' <<<"$runs")
  {
    echo "### Wix autonomous recovery"
    echo
    echo "Factory already active: $active_url"
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
    echo "Latest Factory does not require recovery: $run_url ($conclusion)."
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
repairable_jobs=()
external_jobs=()
governance_jobs=()
repair_excerpt_file="$tmp_dir/repair-excerpts.txt"
: >"$repair_excerpt_file"

permanent_pattern='invalid api.?key|api.?key[^[:cntrl:]]*(invalid|expired|revoked)|token[^[:cntrl:]]*(expired|revoked)|unauthorized|forbidden|permission denied|authentication (failed|required)|login required|model[^[:cntrl:]]*(not found|does not exist|unsupported)|unknown model|invalid model|config(uration)?[^[:cntrl:]]*(invalid|schema|validation)|validation error|bad request|HTTP[^0-9]*(400|401|403|404)'
generic_server_pattern='Unexpected server error|"name"[[:space:]]*:[[:space:]]*"UnknownError"|"ref"[[:space:]]*:[[:space:]]*"err_[A-Za-z0-9_-]+"|HTTP[^0-9]*500'
legacy_transient_pattern='network_error|network error|temporarily unavailable|connection (reset|closed)|ECONNRESET|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)'
governance_pattern='Pinned OpenCode installer integrity check failed|MAIN_PROMPT[^[:cntrl:]]*(FAILED|mismatch)|MANIFEST[^[:cntrl:]]*(FAILED|mismatch)|Unauthorized Director/governance edit|Credential-like file forbidden|Unexpected (integration|rules|dashboard|billing) path|immutable (agent|role|governance)[^[:cntrl:]]*(failed|mismatch)'

append_repair_excerpt() {
  local job_name="$1" log_file="$2"
  {
    printf '\n--- %s ---\n' "$job_name"
    grep -Ei '(^|[^[:alpha:]])(error|failed|failure|fatal|assertion|typeerror|referenceerror|syntaxerror|TS[0-9]{4}|VERDICT:|npm ERR!)' "$log_file" \
      | tail -n 14 \
      | sed -E 's/(token|secret|password|api[_ -]?key)[=: ][^ ]+/\1=[REDACTED]/Ig' \
      | cut -c1-500 || true
  } >>"$repair_excerpt_file"
}

while IFS= read -r encoded_job; do
  job=$(printf '%s' "$encoded_job" | base64 -d)
  job_id=$(jq -r '.id' <<<"$job")
  job_name=$(jq -r '.name' <<<"$job")
  step_count=$(jq '(.steps // []) | length' <<<"$job")
  log_file="$tmp_dir/$job_id.log"

  if ! gh run view "$run_id" --repo "$repository" --job "$job_id" --log >"$log_file" 2>&1; then
    infra_jobs+=("$job_name")
    continue
  fi

  explicit_permanent=false
  if grep -Eqi "$permanent_pattern" "$log_file"; then explicit_permanent=true; fi

  if grep -Fq 'WIX_OPENCODE_FAILURE_KIND=transient' "$log_file"; then
    transient_jobs+=("$job_name")
  elif [[ "$explicit_permanent" == false ]] && grep -Eqi "$generic_server_pattern" "$log_file"; then
    transient_jobs+=("$job_name (generic OpenCode server error)")
  elif grep -Eqi 'endpoint is unavailable|upstream request failed|service unavailable|provider unavailable' "$log_file"; then
    transient_jobs+=("$job_name (provider unavailable)")
  elif [[ "$explicit_permanent" == false ]] && grep -Eqi "$legacy_transient_pattern" "$log_file" && \
       grep -Eqi 'OpenCode .* unavailable after [0-9]+ attempts|OpenCode .* remains unavailable after [0-9]+ attempts' "$log_file"; then
    transient_jobs+=("$job_name (legacy retry marker)")
  elif grep -Eqi "couldn't find remote ref cycle/wix-build/|candidate branch found=false|candidate_found=false|missing candidate snapshot" "$log_file"; then
    dependent_jobs+=("$job_name")
  elif grep -Eqi "$governance_pattern" "$log_file"; then
    governance_jobs+=("$job_name")
  elif [[ "$explicit_permanent" == true ]] && grep -Fq 'WIX_OPENCODE_FAILURE_KIND=permanent' "$log_file"; then
    external_jobs+=("$job_name")
  elif grep -Fq 'WIX_OPENCODE_FAILURE_KIND=permanent' "$log_file"; then
    transient_jobs+=("$job_name (unclassified OpenCode failure)")
  else
    repairable_jobs+=("$job_name")
    append_repair_excerpt "$job_name" "$log_file"
  fi
done < <(jq -r '.[] | @base64' <<<"$failed_jobs")

transient_count=$(( ${#transient_jobs[@]} + ${#infra_jobs[@]} ))
repairable_count=${#repairable_jobs[@]}

if (( transient_count > 0 && repairable_count == 0 && ${#external_jobs[@]} == 0 && ${#governance_jobs[@]} == 0 )); then
  old_attempt=$(gh api "repos/$repository/actions/runs/$run_id" --jq '.run_attempt')
  gh api --method POST "repos/$repository/actions/runs/$run_id/rerun-failed-jobs" >/dev/null

  new_attempt=$((old_attempt + 1))
  for _ in {1..15}; do
    state=$(gh api "repos/$repository/actions/runs/$run_id" --jq '[.status, .run_attempt] | @tsv')
    IFS=$'\t' read -r status observed_attempt <<<"$state"
    if [[ "$status" != completed || "$observed_attempt" -gt "$old_attempt" ]]; then
      new_attempt="$observed_attempt"
      break
    fi
    sleep 2
  done

  transient_list=$(IFS=', '; echo "${transient_jobs[*]:-}")
  infra_list=$(IFS=', '; echo "${infra_jobs[*]:-}")
  {
    echo "### Wix autonomous recovery"
    echo
    echo "Transient recovery triggered: $run_url"
    echo "- GitHub attempt: $old_attempt -> $new_attempt"
    echo "- transient OX: ${transient_list:-none}"
    echo "- runner/bootstrap: ${infra_list:-none}"
  } >>"$summary_file"
  exit 0
fi

if (( repairable_count > 0 && ${#external_jobs[@]} == 0 && ${#governance_jobs[@]} == 0 )); then
  state_b64=$(gh api "repos/$repository/contents/docs/state.json?ref=lab/wix-rules" --jq '.content')
  current=$(printf '%s' "$state_b64" | tr -d '\n' | base64 -d | jq -r '.cycle // 0')
  [[ "$current" =~ ^[0-9]+$ ]]
  next=$((current + 1))

  repair_list=$(IFS=', '; echo "${repairable_jobs[*]}")
  excerpts=$(head -c 5000 "$repair_excerpt_file")
  note=$(cat <<EOF
AUTONOMOUS REPAIR INCIDENT. Previous Factory run $run_id failed in: $repair_list.
This is product/build evidence, not permission to stop. Diagnose the failure, repair the owning product lane(s), preserve all accepted progress, add/regress tests for the root cause, and continue through independent audits and Wix Live QA. Do not weaken tests, safety gates, governance, or evidence requirements. Stop only for a genuinely external prerequisite.
Failure evidence:
$excerpts
EOF
)
  note=$(printf '%s' "$note" | head -c 8000)
  gh workflow run "$workflow" --repo "$repository" --ref main \
    -f cycle_index="$next" -f max_cycles="0" -f human_note="$note"

  {
    echo "### Wix autonomous product repair"
    echo
    echo "Fresh repair cycle dispatched from accepted state."
    echo "- source failure: $run_url"
    echo "- repair jobs: $repair_list"
    echo "- accepted-state cycle -> dispatched cycle: $current -> $next"
  } >>"$summary_file"
  exit 0
fi

external_list=$(IFS=', '; echo "${external_jobs[*]:-}")
governance_list=$(IFS=', '; echo "${governance_jobs[*]:-}")
repair_list=$(IFS=', '; echo "${repairable_jobs[*]:-}")
{
  echo "### Wix autonomous recovery — fail-closed"
  echo
  echo "No unsafe automatic mutation was attempted for $run_url."
  echo "- genuine auth/model/account prerequisites: ${external_list:-none}"
  echo "- governance/safety integrity failures: ${governance_list:-none}"
  echo "- product-repair candidates blocked by the above: ${repair_list:-none}"
} >>"$summary_file"

if (( ${#external_jobs[@]} > 0 )); then
  echo "::error::Factory requires a genuine external authentication/model/account prerequisite; product code cannot safely manufacture it."
elif (( ${#governance_jobs[@]} > 0 )); then
  echo "::error::Factory governance integrity failed closed; autonomous product agents are forbidden from weakening the factory's own controls."
fi
