#!/usr/bin/env bash

set -euo pipefail

max_attempts="${OPENCODE_MAX_ATTEMPTS:-6}"
retry_delay="${OPENCODE_RETRY_DELAY_SECONDS:-300}"
fast_retry_delay="${OPENCODE_FAST_RETRY_DELAY_SECONDS:-60}"
label="${OPENCODE_RETRY_LABEL:-agent}"

[[ "$max_attempts" =~ ^([1-9]|1[0-2])$ ]]
[[ "$retry_delay" =~ ^[0-9]+$ ]]
[[ "$fast_retry_delay" =~ ^[0-9]+$ ]]
(( retry_delay >= 30 && retry_delay <= 900 ))
(( fast_retry_delay >= 30 && fast_retry_delay <= 300 ))
(( $# > 0 ))

log_file=$(mktemp "${RUNNER_TEMP:?}/opencode-${label}.XXXXXX.log")
trap 'rm -f "$log_file"' EXIT

# Explicit permanent causes win over generic wrappers. OpenCode can surface auth,
# config, permission and model errors behind an "Unexpected server error" shell.
permanent_pattern='invalid api.?key|api.?key[^[:cntrl:]]*(invalid|expired|revoked)|token[^[:cntrl:]]*(expired|revoked)|unauthorized|forbidden|permission denied|authentication (failed|required)|login required|model[^[:cntrl:]]*(not found|does not exist|unsupported)|unknown model|invalid model|config(uration)?[^[:cntrl:]]*(invalid|schema|validation)|validation error|bad request|HTTP[^0-9]*(400|401|403|404)'

# Generic server-side / transport failures are retryable. In particular,
# OpenCode 1.18.x can emit only UnknownError + an err_* reference for HTTP 500.
transient_pattern='network_error|network error|temporarily unavailable|endpoint is unavailable|upstream request failed|service unavailable|provider unavailable|connection (reset|closed)|ECONNRESET|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)|Unexpected server error|"name"[[:space:]]*:[[:space:]]*"UnknownError"|"ref"[[:space:]]*:[[:space:]]*"err_[A-Za-z0-9_-]+"'

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

  if grep -Eqi "$permanent_pattern" "$log_file"; then
    echo "WIX_OPENCODE_FAILURE_KIND=permanent label=${label} status=${command_status} reason=explicit" >&2
    echo "::error::OpenCode ${label} exposed an explicit non-transient auth/config/model/permission cause; no provider retry." >&2
    exit "$command_status"
  fi

  if ! grep -Eqi "$transient_pattern" "$log_file"; then
    echo "WIX_OPENCODE_FAILURE_KIND=permanent label=${label} status=${command_status} reason=unclassified" >&2
    echo "::error::OpenCode ${label} failed for an unclassified non-transient cause; no automatic provider retry." >&2
    exit "$command_status"
  fi

  if (( attempt == max_attempts )); then
    echo "WIX_OPENCODE_FAILURE_KIND=transient label=${label} attempts=${max_attempts}" >&2
    echo "::error::OpenCode ${label} remains unavailable after ${max_attempts} attempts; the persistent watchdog may resume the failed jobs later." >&2
    exit 75
  fi

  delay="$retry_delay"
  reason="provider/network"
  if grep -Eqi 'Unexpected server error|"name"[[:space:]]*:[[:space:]]*"UnknownError"|"ref"[[:space:]]*:[[:space:]]*"err_[A-Za-z0-9_-]+"|HTTP[^0-9]*500' "$log_file"; then
    delay="$fast_retry_delay"
    reason="generic-server-500"
  fi

  echo "WIX_OPENCODE_FAILURE_KIND=transient label=${label} attempt=${attempt} reason=${reason}" >&2
  echo "::warning::Transient OpenCode ${reason} failure for ${label}; next attempt in ${delay}s." >&2
  sleep "$delay"
done
