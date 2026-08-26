#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:?}"
workflow="${WIX_LOOP_WORKFLOW:?WIX_LOOP_WORKFLOW is required}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

note_summary() {
  {
    echo "### Wix autonomous product supervisor"
    echo
    printf '%s\n' "$*"
  } >>"$summary_file"
}

get_state() {
  local b64
  b64=$(gh api "repos/$repository/contents/docs/state.json?ref=lab/wix-rules" --jq '.content' 2>/dev/null || true)
  if [[ -n "$b64" ]]; then
    printf '%s' "$b64" | tr -d '\n' | base64 -d 2>/dev/null || printf '%s\n' '{}'
  else
    printf '%s\n' '{}'
  fi
}

get_loop_health() {
  local b64
  b64=$(gh api "repos/$repository/contents/docs/LOOP_HEALTH.json?ref=lab/wix-rules" --jq '.content' 2>/dev/null || true)
  if [[ -n "$b64" ]]; then
    printf '%s' "$b64" | tr -d '\n' | base64 -d 2>/dev/null || printf '%s\n' '{}'
  else
    printf '%s\n' '{}'
  fi
}

ready_verdict() {
  local state run b64 verdict
  state=$(get_state)
  run=$(jq -r '.last_accepted_run // empty' <<<"$state")
  [[ "$run" =~ ^[0-9]+$ ]] || return 1
  b64=$(gh api "repos/$repository/contents/reports/release/READINESS_${run}.md?ref=lab/wix-rules" --jq '.content' 2>/dev/null || true)
  [[ -n "$b64" ]] || return 1
  verdict=$(printf '%s' "$b64" | tr -d '\n' | base64 -d 2>/dev/null | tail -n 1 | sed -n 's/^VERDICT: //p')
  [[ "$verdict" == READY ]]
}

dispatch_cycle() {
  local note="$1" state current next
  state=$(get_state)
  current=$(jq -r '.cycle // 0' <<<"$state")
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  next=$((current + 1))
  note=$(printf '%s' "$note" | head -c 8000)
  gh workflow run "$workflow" --repo "$repository" --ref main \
    -f cycle_index="$next" -f max_cycles="0" -f human_note="$note"
  note_summary "Fresh Product Factory cycle $next dispatched from the last accepted state."
}

# Only the newest supervisor may mutate Factory state during handoff overlap.
if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
  latest_watchdog=$(gh run list --repo "$repository" --workflow wix-watchdog.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0' 2>/dev/null || echo 0)
  if [[ "$latest_watchdog" =~ ^[0-9]+$ ]] && (( latest_watchdog > 0 )) && [[ "$GITHUB_RUN_ID" != "$latest_watchdog" ]]; then
    echo "Supervisor $GITHUB_RUN_ID superseded by watchdog $latest_watchdog; no mutation this tick." >>"$summary_file"
    exit 0
  fi
fi

# READY backed by the release report matching the accepted run is the only normal terminal state.
if ready_verdict; then
  note_summary "Terminal product state proven: READY. Autonomous factory may stop."
  exit 10
fi

runs=$(gh run list --repo "$repository" --workflow "$workflow" --limit 40 \
  --json databaseId,status,conclusion,createdAt,updatedAt,url)

# Keep exactly one live Factory. Duplicate pending runs can starve the real product run.
mapfile -t active_ids < <(jq -r '[.[] | select(.status != "completed")] | sort_by(.createdAt) | reverse | .[].databaseId' <<<"$runs")
if (( ${#active_ids[@]} > 1 )); then
  keeper="${active_ids[0]}"
  for id in "${active_ids[@]:1}"; do
    gh api --method POST "repos/$repository/actions/runs/$id/cancel" >/dev/null 2>&1 || true
  done
  echo "Cancelled duplicate live Factory runs; keeping $keeper."
fi

runs=$(gh run list --repo "$repository" --workflow "$workflow" --limit 40 \
  --json databaseId,status,conclusion,createdAt,updatedAt,url)
active=$(jq -c '[.[] | select(.status != "completed")] | sort_by(.createdAt) | last // empty' <<<"$runs")
if [[ -n "$active" ]]; then
  run_id=$(jq -r '.databaseId' <<<"$active")
  status=$(jq -r '.status' <<<"$active")
  created=$(jq -r '.createdAt' <<<"$active")
  url=$(jq -r '.url' <<<"$active")
  now=$(date -u +%s)
  created_epoch=$(date -u -d "$created" +%s 2>/dev/null || echo "$now")
  age=$((now - created_epoch))

  jobs=$(gh api "repos/$repository/actions/runs/$run_id/jobs?filter=latest&per_page=100" 2>/dev/null || printf '%s' '{"jobs":[]}')
  job_count=$(jq '(.jobs // []) | length' <<<"$jobs")
  running_jobs=$(jq '[.jobs[]? | select(.status == "in_progress")] | length' <<<"$jobs")
  queued_jobs=$(jq '[.jobs[]? | select(.status == "queued" or .status == "pending")] | length' <<<"$jobs")

  if (( age > 900 && job_count == 0 )); then
    gh api --method POST "repos/$repository/actions/runs/$run_id/cancel" >/dev/null 2>&1 || true
    dispatch_cycle "AUTONOMOUS INFRA RECOVERY. Factory run $run_id remained $status for more than 15 minutes without creating any jobs. Treat this as GitHub Actions scheduler infrastructure failure. Re-run from the last accepted product state; preserve all product evidence and continue toward READY."
    exit 0
  fi

  if (( age > 1800 && running_jobs == 0 && queued_jobs > 0 )); then
    gh api --method POST "repos/$repository/actions/runs/$run_id/cancel" >/dev/null 2>&1 || true
    dispatch_cycle "AUTONOMOUS INFRA RECOVERY. Factory run $run_id remained queued for more than 30 minutes with no running job. Re-run from the last accepted state and continue toward READY."
    exit 0
  fi

  note_summary "Factory is active ($status): $url. No duplicate Product Factory was launched."
  exit 0
fi

latest=$(jq -c '[.[] | select(.status == "completed")] | sort_by(.createdAt) | last // empty' <<<"$runs")
if [[ -z "$latest" ]]; then
  dispatch_cycle "AUTONOMOUS CONTINUATION. No Product Factory run exists and READY has not been proven. Start from the last accepted product state and continue until all deterministic, independent-audit, Wix Live and release-readiness gates prove READY."
  exit 0
fi

run_id=$(jq -r '.databaseId' <<<"$latest")
run_url=$(jq -r '.url' <<<"$latest")
conclusion=$(jq -r '.conclusion // ""' <<<"$latest")

# Success/cancelled/neutral is not terminal unless READY evidence exists.
if [[ "$conclusion" != failure ]]; then
  state=$(get_state)
  health=$(get_loop_health)
  stalled=$(jq -r '.stalled // false' <<<"$health")
  reason=$(jq -r '.reason // ""' <<<"$health")
  release_run=$(jq -r '.last_accepted_run // empty' <<<"$state")
  release_verdict=""
  if [[ "$release_run" =~ ^[0-9]+$ ]]; then
    release_b64=$(gh api "repos/$repository/contents/reports/release/READINESS_${release_run}.md?ref=lab/wix-rules" --jq '.content' 2>/dev/null || true)
    if [[ -n "$release_b64" ]]; then
      release_verdict=$(printf '%s' "$release_b64" | tr -d '\n' | base64 -d 2>/dev/null | tail -n 1 | sed -n 's/^VERDICT: //p')
    fi
  fi

  if [[ "$stalled" == true ]]; then
    dispatch_cycle "AUTONOMOUS STAGNATION ESCALATION. Previous completed run $run_id did not prove READY and loop health reported: $reason. This is not permission to stop. Change the repair strategy: isolate the blocking hypothesis, inspect the newest evidence, activate the owning lane, add a discriminating regression/contract test, and attempt a materially different implementation. Preserve accepted progress and all safety/audit requirements."
  elif [[ "$release_verdict" == BLOCKED_EXTERNAL ]]; then
    dispatch_cycle "AUTONOMOUS EXTERNAL-BLOCKER RECHECK. Previous run $run_id reached BLOCKED_EXTERNAL, but READY is the only terminal state. Recheck the prerequisite safely. Do not broaden permissions, expose secrets, publish, or weaken gates. If the prerequisite is now available, continue immediately through Wix Live and release audit; otherwise preserve blocker evidence for the next recheck."
  else
    dispatch_cycle "AUTONOMOUS CONTINUATION. Previous run $run_id completed with conclusion=$conclusion but did not prove READY. Continue from the accepted state. Route every negative audit or live finding to its owning lane, make evidence-producing repairs, and continue through final release readiness."
  fi
  exit 0
fi

jobs=$(gh api "repos/$repository/actions/runs/$run_id/jobs?filter=latest&per_page=100")
failed_jobs=$(jq -c '[.jobs[] | select(.conclusion == "failure")]' <<<"$jobs")
failed_count=$(jq 'length' <<<"$failed_jobs")
if (( failed_count == 0 )); then
  dispatch_cycle "AUTONOMOUS FAILURE RECOVERY. Factory run $run_id failed but exposes no failed job. Treat this as orchestration/runner evidence, start a clean cycle from the last accepted state, and continue toward READY without weakening gates."
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
      | tail -n 16 \
      | sed -E 's/(token|secret|password|api[_ -]?key)[=: ][^ ]+/\1=[REDACTED]/Ig' \
      | cut -c1-500 || true
  } >>"$repair_excerpt_file"
}

while IFS= read -r encoded_job; do
  job=$(printf '%s' "$encoded_job" | base64 -d)
  job_id=$(jq -r '.id' <<<"$job")
  job_name=$(jq -r '.name' <<<"$job")
  log_file="$tmp_dir/$job_id.log"

  if ! gh run view "$run_id" --repo "$repository" --job "$job_id" --log >"$log_file" 2>&1; then
    infra_jobs+=("$job_name")
    continue
  fi

  explicit_permanent=false
  grep -Eqi "$permanent_pattern" "$log_file" && explicit_permanent=true || true

  if grep -Fq 'WIX_OPENCODE_FAILURE_KIND=transient' "$log_file"; then
    transient_jobs+=("$job_name")
  elif [[ "$explicit_permanent" == false ]] && grep -Eqi "$generic_server_pattern" "$log_file"; then
    transient_jobs+=("$job_name (generic OpenCode server error)")
  elif grep -Eqi 'endpoint is unavailable|upstream request failed|service unavailable|provider unavailable' "$log_file"; then
    transient_jobs+=("$job_name (provider unavailable)")
  elif [[ "$explicit_permanent" == false ]] && grep -Eqi "$legacy_transient_pattern" "$log_file"; then
    transient_jobs+=("$job_name (network/provider transient)")
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
  if gh api --method POST "repos/$repository/actions/runs/$run_id/rerun-failed-jobs" >/dev/null 2>&1; then
    note_summary "Transient outage recovery triggered for $run_url. Failed jobs requeued; supervisor will inspect again in five minutes."
  else
    dispatch_cycle "AUTONOMOUS TRANSIENT-OUTAGE FALLBACK. GitHub refused to rerun failed jobs for run $run_id. Start a fresh cycle from the last accepted state and retry the same product work without weakening any gate."
  fi
  exit 0
fi

if (( repairable_count > 0 && ${#governance_jobs[@]} == 0 )); then
  repair_list=$(IFS=', '; echo "${repairable_jobs[*]}")
  excerpts=$(head -c 5000 "$repair_excerpt_file")
  dispatch_cycle "AUTONOMOUS PRODUCT REPAIR. Previous Factory run $run_id failed in: $repair_list. Diagnose and repair the owning product lane(s), preserve every accepted change, add regression/contract tests for the root cause, and continue through independent audits and Wix Live QA. Never weaken tests, safety, governance or evidence requirements. Failure evidence: $excerpts"
  exit 0
fi

# External prerequisites are fail-closed for mutation, but not terminal: recheck them.
if (( ${#external_jobs[@]} > 0 )); then
  if gh api --method POST "repos/$repository/actions/runs/$run_id/rerun-failed-jobs" >/dev/null 2>&1; then
    note_summary "External prerequisite remains fail-closed but non-terminal. Failed jobs requeued for safe recheck; no permission or secret broadened."
  else
    note_summary "External prerequisite remains fail-closed. Supervisor stays alive and will recheck in five minutes."
  fi
  exit 0
fi

# Governance failures are never 'fixed' by weakening controls. The supervisor remains alive.
if (( ${#governance_jobs[@]} > 0 )); then
  note_summary "Governance integrity failure detected. No autonomous weakening allowed. Supervisor remains alive and will re-evaluate current main/accepted state every five minutes until integrity is restored."
  exit 0
fi

dispatch_cycle "AUTONOMOUS UNCLASSIFIED FAILURE RECOVERY. Previous run $run_id failed in a way not safely classified. Do not stop and do not weaken governance. Diagnose from logs in a fresh cycle, repair only product-owned defects, preserve accepted state, and continue until READY."
