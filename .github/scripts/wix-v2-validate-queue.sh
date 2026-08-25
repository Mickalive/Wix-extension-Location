#!/usr/bin/env bash
set -euo pipefail
: "${CYCLE_INDEX:?}" "${MAX_CYCLES:?}" "${MAIN_PROMPT_SHA256:?}"
test "$GITHUB_REPOSITORY" = "Mickalive/Wix-extension-Location"
[[ "$CYCLE_INDEX" =~ ^[1-9][0-9]*$ ]]
[[ "$MAX_CYCLES" =~ ^[0-9]+$ ]]
(( MAX_CYCLES == 0 || CYCLE_INDEX <= MAX_CYCLES ))
printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | sha256sum --check --strict
test "$(jq -r '.phase' docs/state.json)" = build
grep -q STABLE_PRODUCTION docs/WIX_TECHNICAL_CONTRACT.md
jq -e '.lanes|type=="object"' docs/NEXT_CYCLE.json >/dev/null
for role in integration rules dashboard billing; do
  status=$(jq -er --arg r "$role" '.lanes[$r].status|select(.=="active" or .=="blocked" or .=="complete")' docs/NEXT_CYCLE.json)
  if [[ "$status" == active ]]; then
    jq -e --arg r "$role" '(.lanes[$r].task_id|type=="string" and length>0) and (.lanes[$r].task|type=="string" and length>0) and (.lanes[$r].why_needed|type=="string" and length>0) and (.lanes[$r].source_evidence|type=="array" and length>0) and (.lanes[$r].acceptance_criteria|type=="array" and length>0)' docs/NEXT_CYCLE.json >/dev/null
  elif [[ "$status" == blocked ]]; then
    jq -e --arg r "$role" '.lanes[$r].blocker|type=="string" and length>0' docs/NEXT_CYCLE.json >/dev/null
  else
    jq -e --arg r "$role" '.lanes[$r].completion_evidence|type=="string" and length>0' docs/NEXT_CYCLE.json >/dev/null
  fi
done
{
  echo "cycle_index=$CYCLE_INDEX"
  echo "max_cycles=$MAX_CYCLES"
  echo "accepted_sha=$(git rev-parse HEAD)"
} >> "${GITHUB_OUTPUT:?}"
