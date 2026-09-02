#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}" "${WIX_CLI_VERSION:?}" "${EXPECTED_WIX_APP_ID:?}" "${GITHUB_ENV:?}"

STATE="$GITHUB_WORKSPACE/.factory/state.json"
SITE_STATE="$GITHUB_WORKSPACE/.factory/wix-dev-site.json"
phase="$(jq -r '.phase' "$STATE")"
effective_phase="$phase"
if [[ "$phase" == BLOCKED_EXTERNAL ]]; then
  effective_phase="$(jq -r '.blocked_resume_phase // "WIX_QA"' "$STATE")"
fi

# Wix runtime preparation belongs only to empirical Wix/release gates.
case "$effective_phase" in
  WIX_QA|RELEASE_AUDIT) ;;
  *) exit 0 ;;
esac

ref="$(jq -r '.candidate.sha // .accepted_base' "$STATE")"
[[ -n "$ref" && "$ref" != null ]] || exit 0

TMP="$RUNNER_TEMP/wix-env-preflight-$GITHUB_RUN_ID"
cleanup(){
  git -C "$GITHUB_WORKSPACE" worktree remove --force "$TMP" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

rm -rf "$TMP"
git -C "$GITHUB_WORKSPACE" worktree add --detach "$TMP" "$ref" >/dev/null

# Malformed/core-only candidates are product defects, not auth/network defects.
# Let the authoritative state machine or deterministic final gate classify them.
[[ -f "$TMP/wix.config.json" ]] || exit 0
if ! jq -e --arg id "$EXPECTED_WIX_APP_ID" '.appId==$id and (.projectId|type=="string" and length>0) and (.projectType|type=="string" and length>0)' "$TMP/wix.config.json" >/dev/null 2>&1; then
  exit 0
fi

[[ -n "${WIX_API_KEY:-}" ]] || {
  echo "::error::Wix live gate requires WIX_API_KEY."
  exit 41
}
[[ -f "$SITE_STATE" ]] || {
  echo "::error::Missing persisted Wix development-site state."
  exit 42
}
site_id="$(jq -r --arg app "$EXPECTED_WIX_APP_ID" 'select(.appId==$app) | .siteId // empty' "$SITE_STATE")"
[[ -n "$site_id" ]] || {
  echo "::error::Persisted Wix development-site state does not match the expected app."
  exit 42
}

LOGIN_LOG="$RUNNER_TEMP/wix-env-login-$GITHUB_RUN_ID.log"
SELECT_LOG="$RUNNER_TEMP/wix-env-select-$GITHUB_RUN_ID.log"
PULL_LOG="$RUNNER_TEMP/wix-env-pull-$GITHUB_RUN_ID.log"
: >"$LOGIN_LOG"; : >"$SELECT_LOG"; : >"$PULL_LOG"

set +e
npx -y "@wix/cli@${WIX_CLI_VERSION}" login --api-key "$WIX_API_KEY" >"$LOGIN_LOG" 2>&1
rc=$?
set -e
: >"$LOGIN_LOG"
(( rc == 0 )) || { echo "::error::Wix CLI authentication failed during live-gate preflight."; exit 43; }

set +e
(cd "$TMP" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site select "$site_id") >"$SELECT_LOG" 2>&1
rc=$?
set -e
if (( rc != 0 )); then
  if grep -Eqi 'FailedToIdentifyProgramFlow|configuration file.*(malformed|missing required)|project type identification' "$SELECT_LOG"; then
    printf 'WIX_SITE_ID=__STRUCTURE_INVALID__\n' >>"$GITHUB_ENV"
    printf 'WIX_CLIENT_ID=__STRUCTURE_INVALID__\n' >>"$GITHUB_ENV"
    printf 'WIX_PREFLIGHT_STRUCTURE_INVALID=1\n' >>"$GITHUB_ENV"
    echo "::warning::Wix CLI cannot identify the candidate project; handing this to the product/scaffold repair path rather than BLOCKED_EXTERNAL."
    : >"$SELECT_LOG"
    exit 0
  fi
  tail -n80 "$SELECT_LOG" >&2
  : >"$SELECT_LOG"
  exit 44
fi
: >"$SELECT_LOG"

printf 'WIX_SITE_ID=%s\n' "$site_id" >"$TMP/.env.local"
set +e
(cd "$TMP" && npx -y "@wix/cli@${WIX_CLI_VERSION}" env pull) >"$PULL_LOG" 2>&1
rc=$?
set -e
if (( rc != 0 )); then
  tail -n80 "$PULL_LOG" >&2
  : >"$PULL_LOG"
  exit 45
fi
: >"$PULL_LOG"

grep -Eq '^WIX_CLIENT_ID=.+$' "$TMP/.env.local" || {
  echo "::error::Wix env pull completed without WIX_CLIENT_ID."
  exit 46
}

# Export only non-secret Wix runtime identifiers needed by subsequent gates.
while IFS='=' read -r key value; do
  [[ "$key" =~ ^WIX_[A-Z0-9_]+$ ]] || continue
  [[ "$key" =~ (SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY) ]] && continue
  [[ -n "$value" ]] || continue
  printf '%s=%s\n' "$key" "$value" >>"$GITHUB_ENV"
done <"$TMP/.env.local"
printf 'WIX_SITE_ID=%s\n' "$site_id" >>"$GITHUB_ENV"

echo "Wix candidate environment prepared for phase $phase (resume $effective_phase) on site $site_id."
