#!/usr/bin/env bash
set -euo pipefail

probe_root="${1:?probe root required}"
state_file="${2:?state file required}"
evidence_root="${3:?evidence root required}"
out="${RUNNER_TEMP:?}/wix-model-selection"
mkdir -p "$out"
selection="$out/selection.json"

mapfile -t probe_files < <(find "$probe_root" -type f -name probe.json -print | sort)
(( ${#probe_files[@]} > 0 ))

healthy=()
responsive=()
for file in "${probe_files[@]}"; do
  if jq -e '.healthy==true' "$file" >/dev/null; then
    model="$(jq -r '.model' "$file")"
    elapsed="$(jq -r '.elapsedSeconds // 9999' "$file")"
    healthy+=("$model")
    if [[ "$elapsed" =~ ^[0-9]+$ ]] && (( elapsed <= 30 )); then
      responsive+=("$model")
    fi
  fi
done

healthy_count=${#healthy[@]}
responsive_count=${#responsive[@]}
if (( healthy_count == 0 )); then
  jq -n --slurpfile probes <(jq -s '.' "${probe_files[@]}") \
    '{schemaVersion:2,healthyCount:0,responsiveCount:0,current:null,probes:$probes[0]}' > "$selection"
  echo "::error::No free OpenCode model passed the real tool-call probe." >&2
  cat "$selection"
  exit 75
fi

contains() {
  local needle="$1"; shift
  local item
  for item in "$@"; do [[ "$item" == "$needle" ]] && return 0; done
  return 1
}
is_healthy(){ contains "$1" "${healthy[@]}"; }
is_responsive(){ contains "$1" "${responsive[@]}"; }

# OX is preferred whenever it is actually healthy. The remaining order is task-specific.
integration_pref=(
  x-preview-f-free mimo-v2.5-free deepseek-v4-flash-free north-mini-code-free
  nemotron-3-ultra-free laguna-s-2.1-free hy3-free big-pickle
  muse-spark-1.2-contributor-free ling-3.0-flash-free nemotron-3.5-lightning-free ling-3.0-tiny-free
)
logic_pref=(
  x-preview-f-free deepseek-v4-flash-free mimo-v2.5-free nemotron-3-ultra-free
  north-mini-code-free laguna-s-2.1-free hy3-free big-pickle
  ling-3.0-flash-free nemotron-3.5-lightning-free muse-spark-1.2-contributor-free ling-3.0-tiny-free
)
ui_pref=(
  x-preview-f-free mimo-v2.5-free muse-spark-1.2-contributor-free deepseek-v4-flash-free
  north-mini-code-free laguna-s-2.1-free hy3-free big-pickle
  nemotron-3-ultra-free ling-3.0-flash-free nemotron-3.5-lightning-free ling-3.0-tiny-free
)
review_pref=(
  x-preview-f-free laguna-s-2.1-free mimo-v2.5-free nemotron-3-ultra-free
  deepseek-v4-flash-free hy3-free muse-spark-1.2-contributor-free north-mini-code-free
  big-pickle ling-3.0-flash-free nemotron-3.5-lightning-free ling-3.0-tiny-free
)
director_pref=(
  x-preview-f-free mimo-v2.5-free laguna-s-2.1-free nemotron-3-ultra-free
  deepseek-v4-flash-free hy3-free north-mini-code-free big-pickle
  muse-spark-1.2-contributor-free ling-3.0-flash-free nemotron-3.5-lightning-free ling-3.0-tiny-free
)
live_pref=(
  x-preview-f-free mimo-v2.5-free laguna-s-2.1-free deepseek-v4-flash-free
  nemotron-3-ultra-free north-mini-code-free hy3-free big-pickle
  muse-spark-1.2-contributor-free ling-3.0-flash-free nemotron-3.5-lightning-free ling-3.0-tiny-free
)

is_excluded() {
  local candidate="$1"; shift
  local excluded
  for excluded in "$@"; do [[ -n "$excluded" && "$excluded" == "$candidate" ]] && return 0; done
  return 1
}

rank_chain() {
  local pref_name="$1"; shift
  local -n pref="$pref_name"
  local candidate
  local -a result=()

  for candidate in "${pref[@]}"; do
    is_responsive "$candidate" || continue
    is_excluded "$candidate" "$@" && continue
    contains "$candidate" "${result[@]}" || result+=("$candidate")
  done
  for candidate in "${pref[@]}"; do
    is_healthy "$candidate" || continue
    is_excluded "$candidate" "$@" && continue
    contains "$candidate" "${result[@]}" || result+=("$candidate")
  done
  for candidate in "${pref[@]}"; do
    is_responsive "$candidate" || continue
    is_excluded "$candidate" "$@" || continue
    contains "$candidate" "${result[@]}" || result+=("$candidate")
  done
  for candidate in "${pref[@]}"; do
    is_healthy "$candidate" || continue
    is_excluded "$candidate" "$@" || continue
    contains "$candidate" "${result[@]}" || result+=("$candidate")
  done

  (( ${#result[@]} > 0 ))
  printf 'opencode/%s ' "${result[@]}"
}

latest_model_for() {
  local agent="$1" file
  file="$(find "$evidence_root" -maxdepth 1 -type f -name "run_*_${agent}_model.txt" 2>/dev/null | sort -V | tail -n1)"
  [[ -n "$file" ]] || return 0
  sed -n 's#^opencode/##p' "$file" | head -n1
}

phase="$(jq -r '.phase' "$state_file")"
lane="$(jq -r '.lane // "integration"' "$state_file")"
builder_agent=""
auditor_agent=""
builder_pref=logic_pref

case "$lane" in
  integration) builder_agent=wix-integration-builder; auditor_agent=integration-auditor; builder_pref=integration_pref;;
  rules) builder_agent=rules-engine-builder; auditor_agent=rules-auditor; builder_pref=logic_pref;;
  dashboard) builder_agent=dashboard-builder; auditor_agent=dashboard-auditor; builder_pref=ui_pref;;
  billing) builder_agent=billing-builder; auditor_agent=billing-auditor; builder_pref=logic_pref;;
  *) echo "::error::Unknown lane $lane" >&2; exit 2;;
esac

builder_upstream="$(latest_model_for "$builder_agent")"
lane_audit_upstream="$(latest_model_for "$auditor_agent")"
integrated_upstream="$(latest_model_for integrated-auditor)"
wix_upstream="$(latest_model_for wix-live-auditor)"

builder_models="$(rank_chain "$builder_pref")"
review_models=""
role="$builder_agent"

case "$phase" in
  BUILD)
    role="$builder_agent"
    review_models="$(rank_chain review_pref "$builder_upstream")"
    ;;
  AUDIT)
    role="$auditor_agent"
    review_models="$(rank_chain review_pref "$builder_upstream")"
    ;;
  INTEGRATED_AUDIT)
    role=integrated-auditor
    review_models="$(rank_chain review_pref "$lane_audit_upstream" "$builder_upstream")"
    ;;
  WIX_QA|BLOCKED_EXTERNAL)
    role=wix-live-auditor
    review_models="$(rank_chain live_pref "$integrated_upstream")"
    ;;
  RELEASE_AUDIT)
    role=release-readiness-auditor
    review_models="$(rank_chain review_pref "$wix_upstream" "$integrated_upstream")"
    ;;
  PLAN)
    role=wix-build-director
    review_models="$(rank_chain director_pref)"
    ;;
  READY)
    role=none
    review_models="$(rank_chain review_pref)"
    ;;
  *)
    echo "::error::Unknown factory phase $phase" >&2
    exit 2
    ;;
esac

builder_models="${builder_models% }"
review_models="${review_models% }"
builder_primary="${builder_models%% *}"
review_primary="${review_models%% *}"

jq -n \
  --arg phase "$phase" \
  --arg lane "$lane" \
  --arg role "$role" \
  --arg builderChain "$builder_models" \
  --arg reviewChain "$review_models" \
  --arg builderPrimary "$builder_primary" \
  --arg reviewPrimary "$review_primary" \
  --argjson healthyCount "$healthy_count" \
  --argjson responsiveCount "$responsive_count" \
  --slurpfile probes <(jq -s '.' "${probe_files[@]}") \
  '{schemaVersion:2,policy:"live headless tool-call health -> responsive tier -> task-specific capability order; OX/x-preview first when healthy; independent audit primary preferred; upstream models retained only as fallback",responsiveThresholdSeconds:30,healthyCount:$healthyCount,responsiveCount:$responsiveCount,current:{phase:$phase,lane:$lane,role:$role,builderChain:$builderChain,reviewChain:$reviewChain,builderPrimary:$builderPrimary,reviewPrimary:$reviewPrimary},probes:$probes[0]}' > "$selection"

echo "healthy_count=$healthy_count" >> "${GITHUB_OUTPUT:?}"
echo "builder_models=$builder_models" >> "$GITHUB_OUTPUT"
echo "review_models=$review_models" >> "$GITHUB_OUTPUT"
echo "selection_b64=$(base64 -w0 "$selection")" >> "$GITHUB_OUTPUT"
cat "$selection"
