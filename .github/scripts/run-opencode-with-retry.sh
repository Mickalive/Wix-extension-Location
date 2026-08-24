#!/usr/bin/env bash

set -euo pipefail

max_attempts="${OPENCODE_MAX_ATTEMPTS:-6}"
retry_delay="${OPENCODE_RETRY_DELAY_SECONDS:-300}"
label="${OPENCODE_RETRY_LABEL:-agent}"

[[ "$max_attempts" =~ ^([1-9]|1[0-2])$ ]]
[[ "$retry_delay" =~ ^[0-9]+$ ]]
(( retry_delay >= 30 && retry_delay <= 900 ))
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

  if (( command_status == 0 )); then
    exit 0
  fi

  if ! grep -Eqi \
    'network_error|network error|temporarily unavailable|connection (reset|closed)|ECONNRESET|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)' \
    "$log_file"; then
    echo "WIX_OPENCODE_FAILURE_KIND=permanent label=${label} status=${command_status}" >&2
    echo "::error::OpenCode ${label} failed for a non-transient cause; no automatic provider retry." >&2
    exit "$command_status"
  fi

  if (( attempt == max_attempts )); then
    echo "WIX_OPENCODE_FAILURE_KIND=transient label=${label} attempts=${max_attempts}" >&2
    echo "::error::OpenCode ${label} remains unavailable after ${max_attempts} attempts; the persistent watchdog may resume the failed jobs later." >&2
    exit 75
  fi

  echo "::warning::Transient provider failure for ${label}; next attempt in ${retry_delay}s (5 minutes by default)." >&2
  sleep "$retry_delay"
done
