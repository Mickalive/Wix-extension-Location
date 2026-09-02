#!/usr/bin/env bash
set -Eeuo pipefail

PRODUCT="${1:?product worktree required}"

fail(){
  echo "::error::REAL_WIX_RUNTIME_NOT_READY: $1" >&2
  exit 20
}

[[ -f "$PRODUCT/wix.config.json" ]] || fail "missing wix.config.json"
[[ -f "$PRODUCT/src/extensions.ts" ]] || fail "src/extensions.ts is missing; no CLI-registered Wix extensions exist"

grep -Eq '\.use\(' "$PRODUCT/src/extensions.ts" || fail "src/extensions.ts contains no .use(...) registrations"

mapfile -t ext_files < <(find "$PRODUCT/src/extensions" -type f -name '*.extension.ts' 2>/dev/null | sort)
(( ${#ext_files[@]} >= 5 )) || fail "expected real generated Wix extension builders (2 dashboard pages + modal + 2 booking events at minimum); found ${#ext_files[@]}"

# Every generated extension builder must carry a UUID-shaped id. These values
# originate from `wix generate`; this check never invents or rewrites them.
for f in "${ext_files[@]}"; do
  grep -Eqi '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' "$f" \
    || fail "generated extension builder has no Wix UUID: ${f#$PRODUCT/}"
done

# The old staging inventory is a hard release blocker until integration flips
# every required registration after authenticated generation / API creation.
if [[ -f "$PRODUCT/src/platform/registration/extensionsManifest.ts" ]] && grep -Fq 'PLANNED_UNTIL_T_VP0' "$PRODUCT/src/platform/registration/extensionsManifest.ts"; then
  fail "registration inventory still contains PLANNED_UNTIL_T_VP0"
fi

# Real dashboard runtime: generated dashboard/page sources must be React/TSX,
# and the test-only UiDocument abstraction must not be their runtime entrypoint.
mapfile -t dashboard_tsx < <(find "$PRODUCT/src/extensions/dashboard" -type f -name '*.tsx' 2>/dev/null | sort)
(( ${#dashboard_tsx[@]} >= 3 )) || fail "real React dashboard surfaces are missing (need 2 pages + 1 modal)"
for f in "${dashboard_tsx[@]}"; do
  grep -Eq "from ['\"]react['\"]|<[A-Za-z]" "$f" || fail "dashboard surface is not a real React/TSX implementation: ${f#$PRODUCT/}"
done
if grep -RIl --include='*.tsx' "ui/dom/kit\|UiDocument\|UiNode" "$PRODUCT/src/extensions/dashboard" 2>/dev/null | grep -q .; then
  fail "a generated dashboard extension still mounts the test-only UiDocument/UiNode runtime"
fi

# HTTP APIs are runtime-discovered by Astro, so they do not appear in
# src/extensions.ts. They nevertheless must physically exist before READY.
for route in ruleset apply-plan mutation-status recover meter; do
  [[ -f "$PRODUCT/src/pages/api/$route.ts" || -f "$PRODUCT/src/pages/api/$route.js" ]] \
    || fail "missing real Wix HTTP adapter src/pages/api/$route.ts"
done

# At least one generated data-collection aggregator must exist; integration may
# add several concrete collection files under it.
find "$PRODUCT/src/extensions/backend" -type f \( -name '*data-collections*.extension.ts' -o -name 'data-collections.extension.ts' \) 2>/dev/null | grep -q . \
  || fail "no generated Wix data-collections extension is registered"

# Bookings Validation is not currently in the unified CLI's supported SPI enum.
# Integration therefore records the authenticated App Extensions API/dashboard
# component proof here after creating it on the actual Wix app draft.
REG="$PRODUCT/src/platform/registration/live-wix-registration.json"
[[ -f "$REG" ]] || fail "missing authenticated live-wix-registration.json proof"
jq -e '
  .schemaVersion >= 1 and
  .appId and
  .bookingsValidation.registered == true and
  (.bookingsValidation.componentId | type == "string" and length > 0) and
  (.dashboardPages | type == "array" and length >= 2) and
  (.dashboardModal.registered == true) and
  (.bookingEvents | type == "array" and length >= 2) and
  (.dataCollections.registered == true)
' "$REG" >/dev/null || fail "live Wix registration proof is incomplete"

echo "REAL_WIX_RUNTIME_READY"
