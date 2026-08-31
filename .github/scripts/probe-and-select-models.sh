#!/usr/bin/env bash
set -Eeuo pipefail

: "${RUNNER_TEMP:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_WORKSPACE:?}" "${GITHUB_ENV:?}"

ROOT="$RUNNER_TEMP/wix-inline-models-$GITHUB_RUN_ID"
OUT="$ROOT/selection.outputs"
mkdir -p "$ROOT"
: >"$OUT"

# Keep a compact independent pool. These cover builder/reviewer preferences while
# avoiding a 12-job matrix on every single state transition.
models=(
  x-preview-f-free
  mimo-v2.5-free
  big-pickle
  muse-spark-1.2-contributor-free
  north-mini-code-free
  laguna-s-2.1-free
)

pids=()
for model in "${models[@]}"; do
  (
    cd "$GITHUB_WORKSPACE"
    RUNNER_TEMP="$ROOT" bash .github/scripts/probe-model.sh "$model" >/dev/null
  ) &
  pids+=("$!")
done

for pid in "${pids[@]}"; do
  wait "$pid" || true
done

GITHUB_OUTPUT="$OUT" RUNNER_TEMP="$ROOT" \
  bash "$GITHUB_WORKSPACE/.github/scripts/select-models.sh" \
    "$ROOT" "$GITHUB_WORKSPACE/.factory/state.json" "$GITHUB_WORKSPACE/.factory/evidence" >/dev/null

builder_models="$(sed -n 's/^builder_models=//p' "$OUT" | tail -n1)"
review_models="$(sed -n 's/^review_models=//p' "$OUT" | tail -n1)"
selection_b64="$(sed -n 's/^selection_b64=//p' "$OUT" | tail -n1)"
healthy_count="$(sed -n 's/^healthy_count=//p' "$OUT" | tail -n1)"

[[ -n "$builder_models" && -n "$review_models" && -n "$selection_b64" ]] || {
  echo "::error::Model selection did not produce complete chains."
  exit 75
}

printf 'OX_BUILDER_MODELS=%s\n' "$builder_models" >>"$GITHUB_ENV"
printf 'OX_REVIEW_MODELS=%s\n' "$review_models" >>"$GITHUB_ENV"
mkdir -p "$GITHUB_WORKSPACE/.factory/evidence"
printf '%s' "$selection_b64" | base64 -d >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_model_selection.json"
jq -e '.schemaVersion==2 and .healthyCount>=1 and .current.builderChain and .current.reviewChain' \
  "$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_model_selection.json" >/dev/null

echo "Selected $healthy_count healthy model(s) for the current authoritative transition."
