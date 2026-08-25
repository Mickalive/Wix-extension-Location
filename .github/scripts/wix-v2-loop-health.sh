#!/usr/bin/env bash
set -euo pipefail
: "${CYCLE_INDEX:?}" "${ACCEPTED_CHANGES:?}" "${ADOPTED:?}" "${FINAL_GATE:?}"
file=docs/LOOP_HEALTH.json
[[ -f "$file" ]] || printf '%s\n' '{"schema_version":1,"last_cycle":0,"last_task_fingerprint":"","stagnant_cycles":0,"same_task_cycles":0,"last_accepted_product_changes":0,"stalled":false,"reason":null}' > "$file"
prev_fp=$(jq -r '.last_task_fingerprint // ""' "$file")
prev_stagnant=$(jq -r '.stagnant_cycles // 0' "$file")
prev_same=$(jq -r '.same_task_cycles // 0' "$file")
next_fp=$(jq -c '[.lanes|to_entries[]|{role:.key,status:.value.status,task_id:(.value.task_id//null),blocker:(.value.blocker//null)}]|sort_by(.role)' docs/NEXT_CYCLE.json | sha256sum | awk '{print $1}')
product_changes=0
[[ "$ADOPTED" == true && "$FINAL_GATE" == passed ]] && product_changes="$ACCEPTED_CHANGES"
if (( product_changes == 0 )); then stagnant=$((prev_stagnant + 1)); else stagnant=0; fi
if [[ "$next_fp" == "$prev_fp" ]]; then same=$((prev_same + 1)); else same=0; fi
stalled=false
reason=null
if (( stagnant >= 2 )); then stalled=true; reason='"two_consecutive_cycles_without_accepted_product_change"'; fi
if (( same >= 3 )); then stalled=true; reason='"same_task_queue_three_consecutive_cycles"'; fi
jq -n --argjson cycle "$CYCLE_INDEX" --arg fp "$next_fp" --argjson stagnant "$stagnant" --argjson same "$same" --argjson changes "$product_changes" --argjson stalled "$stalled" --argjson reason "$reason" '{schema_version:1,last_cycle:$cycle,last_task_fingerprint:$fp,stagnant_cycles:$stagnant,same_task_cycles:$same,last_accepted_product_changes:$changes,stalled:$stalled,reason:$reason}' > "$file"
echo "stalled=$stalled" >> "${GITHUB_OUTPUT:?}"
