#!/usr/bin/env bash
set -euo pipefail

model="${1:?model id required}"
out="${RUNNER_TEMP:?}/model-probe-$model"
mkdir -p "$out"
slug="${model//[^A-Za-z0-9_.-]/_}"
target=".factory-probe-target-$slug"
nonce="WIX_PROBE_${GITHUB_RUN_ID:-local}_${RANDOM}_${RANDOM}_$(date +%s)"
printf '%s\n' "$nonce" > "$target"
log="$out/probe.log"
started=$(date +%s)

set +e
timeout --signal=TERM --kill-after=10s 90s \
  opencode run --model "opencode/$model" --agent model-probe \
  "This is a health probe. You MUST use the bash tool to run exactly: cat $target . Then reply with exactly the file content and nothing else. Do not guess it." \
  >"$log" 2>&1
status=$?
set -e

healthy=false
if (( status == 0 )) && grep -Fq "$nonce" "$log"; then
  healthy=true
fi

elapsed=$(( $(date +%s) - started ))
reason="ok"
if [[ "$healthy" != true ]]; then
  if (( status == 124 || status == 137 )); then
    reason="timeout"
  elif grep -Eqi 'freeusagelimiterror|too many requests|rate[_ -]?limit|429' "$log"; then
    reason="rate-limit"
  elif grep -Eqi 'forbidden|403|not supported|unavailable|unknown model|no such model|model[^[:alnum:]]*(not found|invalid)' "$log"; then
    reason="unavailable"
  elif grep -Eqi 'unexpected server error|internal server error|upstream|service unavailable|bad gateway|gateway timeout|502|503|504' "$log"; then
    reason="provider-error"
  elif (( status == 0 )); then
    reason="tool-proof-missing"
  else
    reason="client-or-model-error"
  fi
fi

jq -n \
  --arg model "$model" \
  --argjson healthy "$healthy" \
  --arg reason "$reason" \
  --argjson exitStatus "$status" \
  --argjson elapsedSeconds "$elapsed" \
  '{schemaVersion:1,model:$model,healthy:$healthy,reason:$reason,exitStatus:$exitStatus,elapsedSeconds:$elapsedSeconds,proof:"headless bash tool-call nonce round-trip"}' \
  > "$out/probe.json"

rm -f "$target" "$log"
cat "$out/probe.json"
exit 0
