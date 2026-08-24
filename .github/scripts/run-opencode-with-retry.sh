#!/usr/bin/env bash
set -euo pipefail

max_attempts="${OPENCODE_MAX_ATTEMPTS:-3}"
retry_delay="${OPENCODE_RETRY_DELAY_SECONDS:-15}"
label="${OPENCODE_RETRY_LABEL:-agent}"

[[ "$max_attempts" =~ ^[1-5]$ ]]
[[ "$retry_delay" =~ ^([1-9]|[1-5][0-9]|60)$ ]]
(( $# > 0 ))

log_file=$(mktemp "${RUNNER_TEMP:?}/opencode-${label}.XXXXXX.log")
trap 'rm -f "$log_file"' EXIT

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  : > "$log_file"
  echo "OpenCode ${label}: attempt ${attempt}/${max_attempts}."
  set +e
  "$@" 2>&1 | tee "$log_file"
  command_status=${PIPESTATUS[0]}
  set -e
  if (( command_status == 0 )); then exit 0; fi
  if ! grep -Eqi 'network_error|network error|temporarily unavailable|connection (reset|closed)|ECONNRESET|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)' "$log_file"; then
    echo "::error::OpenCode ${label} failed for a non-transient cause." >&2
    exit "$command_status"
  fi
  if (( attempt == max_attempts )); then
    echo "::error::OpenCode ${label} unavailable after ${max_attempts} attempts." >&2
    exit "$command_status"
  fi
  delay=$((retry_delay * attempt))
  echo "::warning::Transient provider failure for ${label}; retry in ${delay}s." >&2
  sleep "$delay"
done
