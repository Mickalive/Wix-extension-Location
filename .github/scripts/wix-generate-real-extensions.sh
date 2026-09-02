#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}" "${EXPECTED_WIX_APP_ID:?}" "${WIX_CLI_VERSION:?}" "${WIX_API_KEY:?}"
PRODUCT="${1:?product worktree required}"
ROOT="${2:-$RUNNER_TEMP/wix-real-extensions-$GITHUB_RUN_ID}"
EVIDENCE="$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_generate_real_extensions"
mkdir -p "$ROOT" "$EVIDENCE"

[[ -f "$PRODUCT/wix.config.json" ]] || { echo "::error::missing Wix project binding"; exit 40; }
jq -e --arg id "$EXPECTED_WIX_APP_ID" '.appId==$id' "$PRODUCT/wix.config.json" >/dev/null || { echo "::error::wrong Wix app binding"; exit 40; }

LOGIN="$ROOT/login.log"
set +e
npx -y "@wix/cli@${WIX_CLI_VERSION}" login --api-key "$WIX_API_KEY" >"$LOGIN" 2>&1
rc=$?
set -e
: >"$LOGIN"
(( rc == 0 )) || { echo "::error::Wix CLI API-key login failed"; exit 41; }

run_generate(){
  local label="$1" params="$2" log="$EVIDENCE/${label}.log"
  echo "Generating $label with official Wix CLI"
  set +e
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" generate --params "$params") >"$log" 2>&1
  local rc=$?
  set -e
  if (( rc != 0 )); then
    echo "::error::wix generate failed for $label"
    tail -n120 "$log" >&2 || true
    # Capture the current schema so the next repair is evidence-driven rather
    # than guessing a changed parameter contract.
    set +e
    (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" schema generate --type "$(jq -r '.extensionType' <<<"$params")") >"$EVIDENCE/${label}.schema.log" 2>&1
    set -e
    exit 42
  fi
}

# Idempotence is based on generated registration paths, not invented IDs.
# The first successful run creates src/extensions.ts and the CLI-owned builders.
if ! grep -RIl --include='*.extension.ts' 'routePath.*advanced-booking-rules\|advanced-booking-rules' "$PRODUCT/src/extensions" 2>/dev/null | grep -q .; then
  run_generate rules-editor '{"extensionType":"DASHBOARD_PAGE","title":"Advanced Booking Rules","route":"advanced-booking-rules"}'
fi
if ! grep -RIl --include='*.extension.ts' 'routePath.*advanced-booking-rules-usage\|advanced-booking-rules-usage' "$PRODUCT/src/extensions" 2>/dev/null | grep -q .; then
  run_generate locations-usage '{"extensionType":"DASHBOARD_PAGE","title":"Locations Usage","route":"advanced-booking-rules-usage"}'
fi
if ! find "$PRODUCT/src/extensions" -type f -name '*.extension.ts' -path '*diff-confirm*' 2>/dev/null | grep -q .; then
  run_generate diff-confirm '{"extensionType":"DASHBOARD_MODAL","title":"Confirm booking rule changes","folder":"diff-confirm"}'
fi
if ! find "$PRODUCT/src/extensions" -type f -name '*.extension.ts' -path '*booking-confirmed*' 2>/dev/null | grep -q .; then
  run_generate booking-confirmed '{"extensionType":"EVENT","folder":"booking-confirmed"}'
fi
if ! find "$PRODUCT/src/extensions" -type f -name '*.extension.ts' -path '*booking-canceled*' 2>/dev/null | grep -q .; then
  run_generate booking-canceled '{"extensionType":"EVENT","folder":"booking-canceled"}'
fi

[[ -f "$PRODUCT/src/extensions.ts" ]] || { echo "::error::Wix CLI generation produced no src/extensions.ts"; exit 43; }
grep -Eq '\.use\(' "$PRODUCT/src/extensions.ts" || { echo "::error::Wix CLI generation did not register extensions in src/extensions.ts"; exit 43; }

# Do NOT guess the immutable app namespace. Data collections are generated in a
# subsequent authenticated step after the real namespace has been discovered.
# Do NOT fabricate the Bookings Validation component either; current unified
# CLI support does not expose it as a SERVICE_PLUGIN enum member. Integration
# must create/query it through Wix's authenticated App Extensions surface.

find "$PRODUCT/src/extensions" -type f \( -name '*.extension.ts' -o -name '*.tsx' \) -print | sort >"$EVIDENCE/generated-files.txt"
cp "$PRODUCT/src/extensions.ts" "$EVIDENCE/extensions.ts"
jq -n --arg app "$EXPECTED_WIX_APP_ID" --argjson run "$GITHUB_RUN_ID" \
  '{schemaVersion:1,runId:$run,appId:$app,officialCli:true,generated:["DASHBOARD_PAGE:advanced-booking-rules","DASHBOARD_PAGE:advanced-booking-rules-usage","DASHBOARD_MODAL:diff-confirm","EVENT:booking-confirmed","EVENT:booking-canceled"],dataCollections:"PENDING_REAL_NAMESPACE",bookingsValidation:"PENDING_AUTHENTICATED_COMPONENT_CREATION"}' \
  >"$EVIDENCE/summary.json"

echo "Official Wix extension generation completed."
