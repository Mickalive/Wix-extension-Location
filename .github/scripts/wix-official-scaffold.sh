#!/usr/bin/env bash
set -Eeuo pipefail

PRODUCT="${1:?product worktree required}"
ROOT="${2:?scratch root required}"
: "${EXPECTED_WIX_APP_ID:?}" "${WIX_API_KEY:?}" "${WIX_CLI_VERSION:?}" "${GITHUB_WORKSPACE:?}" "${GITHUB_RUN_ID:?}"

CREATE_NEW_VERSION="0.0.105"
APP_NAME="Advanced Booking Rules"
BOOKINGS_APP_ID="13d21c63-b5ec-5912-8397-c3a5ddb27a97"
BOOKINGS_SITE_TEMPLATE_ID="17b2bf9e-8661-4c92-973c-67502b415e58"
SANDBOX_SITE_NAME="abr-ci-sandbox"
SITE_STATE="$GITHUB_WORKSPACE/.factory/wix-dev-site.json"
mkdir -p "$ROOT"
PKG="$ROOT/pkg"
WORK="$ROOT/work"
mkdir -p "$PKG" "$WORK"
redact(){ sed -E 's/[A-Za-z0-9_=-]{40,}/[REDACTED]/g'; }

set +e
npx -y "@wix/cli@${WIX_CLI_VERSION}" logout >/dev/null 2>&1
npx -y "@wix/cli@${WIX_CLI_VERSION}" login --api-key "$WIX_API_KEY" >"$ROOT/login.log" 2>&1
login_rc=$?
set -e
if (( login_rc != 0 )); then redact <"$ROOT/login.log" | tail -n80 >&2; exit 9; fi
: >"$ROOT/login.log"

(
  cd "$PKG"
  tgz="$(npm pack "@wix/create-new@${CREATE_NEW_VERSION}" --silent)"
  tar -xzf "$tgz"
)
BLANK="$PKG/package/templates/app/blank"
[[ -d "$BLANK" ]] || { echo "::error::Pinned Wix create-new package has no blank app template." >&2; exit 2; }

git config --global user.name wix-official-scaffold
git config --global user.email wix-official-scaffold@users.noreply.github.com
set +e
(
  cd "$WORK"
  timeout 420s npm exec --yes --package="@wix/create-new@${CREATE_NEW_VERSION}" -- create-new app \
    --extend-app-id "$EXPECTED_WIX_APP_ID" \
    --app-name "$APP_NAME" \
    --template-path "$BLANK" \
    --skip-git
) >"$ROOT/create.log" 2>&1
create_rc=$?
set -e

# Current Wix create-new may fail *after* it has generated the project while
# trying to install optional agent skills (`wix skills add`). The generated
# project itself decides validity, not that optional post-task.
CONFIG="$(find "$WORK" -mindepth 2 -maxdepth 5 -type f -name wix.config.json -print -quit)"
if [[ -z "$CONFIG" ]]; then
  echo "::error::Official Wix existing-app scaffold produced no wix.config.json (generator exit $create_rc)." >&2
  redact <"$ROOT/create.log" | tail -n160 >&2
  exit 3
fi
if (( create_rc != 0 )); then
  echo "::warning::Wix generator exited $create_rc after creating the project; continuing because project validity is decided by exact binding checks and a real Wix build."
fi
: >"$ROOT/create.log"

SCAFFOLD="$(dirname "$CONFIG")"
jq -e --arg id "$EXPECTED_WIX_APP_ID" 'type=="object" and .appId==$id and (.projectId|type=="string" and length>0) and (.projectType|type=="string" and length>0)' "$CONFIG" >/dev/null
if jq -e 'paths(scalars) as $p | ($p|map(tostring)|join(".")) | test("secret|token|password|api.?key";"i")' "$CONFIG" >/dev/null; then echo "::error::Generated wix.config.json contains a secret-like field." >&2; exit 4; fi
[[ -f "$SCAFFOLD/package.json" ]] || { echo "::error::Official scaffold has no package.json." >&2; exit 5; }
[[ -f "$SCAFFOLD/tsconfig.json" ]] || { echo "::error::Official scaffold has no tsconfig.json." >&2; exit 6; }
[[ -f "$SCAFFOLD/astro.config.mjs" ]] || { echo "::error::Official scaffold has no astro.config.mjs." >&2; exit 7; }
[[ -f "$SCAFFOLD/src/env.d.ts" ]] || { echo "::error::Official scaffold has no src/env.d.ts." >&2; exit 8; }

set +e
(cd "$SCAFFOLD" && timeout 300s npx -y "@wix/cli@${WIX_CLI_VERSION}" build) >"$ROOT/pristine-build.log" 2>&1
pristine_rc=$?
set -e
if (( pristine_rc != 0 )); then
  echo "::error::The generated exact-app scaffold exists but does not pass a real Wix build." >&2
  redact <"$ROOT/pristine-build.log" | tail -n160 >&2
  exit 10
fi
redact <"$ROOT/pristine-build.log" | tail -n120 >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_official_scaffold_pristine_build.txt"
: >"$ROOT/pristine-build.log"

cp "$CONFIG" "$PRODUCT/wix.config.json"
cp "$SCAFFOLD/astro.config.mjs" "$PRODUCT/astro.config.mjs"
mkdir -p "$PRODUCT/src"
cp "$SCAFFOLD/src/env.d.ts" "$PRODUCT/src/env.d.ts"
if [[ -f "$SCAFFOLD/extensions.ts" ]]; then cp "$SCAFFOLD/extensions.ts" "$PRODUCT/extensions.ts"; fi

PRODUCT_PACKAGE="$PRODUCT/package.json" SCAFFOLD_PACKAGE="$SCAFFOLD/package.json" node <<'NODE'
const fs = require('fs');
const productPath = process.env.PRODUCT_PACKAGE;
const scaffoldPath = process.env.SCAFFOLD_PACKAGE;
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const scaffold = JSON.parse(fs.readFileSync(scaffoldPath, 'utf8'));
const wixScripts = ['build','dev','release','preview','logs','generate'];
const scripts = { ...(product.scripts || {}) };
for (const name of wixScripts) if (scaffold.scripts && scaffold.scripts[name]) scripts[name] = scaffold.scripts[name];
const merged = {
  ...scaffold,
  ...product,
  dependencies: { ...(product.dependencies || {}), ...(scaffold.dependencies || {}) },
  devDependencies: { ...(product.devDependencies || {}), ...(scaffold.devDependencies || {}) },
  scripts,
};
if (scaffold.packageManager) merged.packageManager = scaffold.packageManager;
fs.writeFileSync(productPath, JSON.stringify(merged, null, 2) + '\n');
NODE

PRODUCT_TSCONFIG="$PRODUCT/tsconfig.json" SCAFFOLD_TSCONFIG="$SCAFFOLD/tsconfig.json" node <<'NODE'
const fs = require('fs');
const productPath = process.env.PRODUCT_TSCONFIG;
const scaffoldPath = process.env.SCAFFOLD_TSCONFIG;
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const scaffold = JSON.parse(fs.readFileSync(scaffoldPath, 'utf8'));
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const merged = {
  ...scaffold,
  ...product,
  compilerOptions: { ...(scaffold.compilerOptions || {}), ...(product.compilerOptions || {}) },
  include: uniq([...(scaffold.include || []), ...(product.include || []), 'src/env.d.ts']),
};
if (scaffold.extends) merged.extends = scaffold.extends;
if (scaffold.exclude || product.exclude) merged.exclude = uniq([...(scaffold.exclude || []), ...(product.exclude || [])]);
fs.writeFileSync(productPath, JSON.stringify(merged, null, 2) + '\n');
NODE

rm -f "$PRODUCT/package-lock.json"
(cd "$PRODUCT" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)

parse_site_id_from_list(){
  local file="$1"
  OUT="$file" node <<'NODE'
const fs=require('fs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let preferred=[], fallback=[];
const walk=(v)=>{
  if (!v || typeof v!=='object') return;
  if (Array.isArray(v)) return v.forEach(walk);
  for (const [k,x] of Object.entries(v)) {
    if (typeof x==='string' && uuid.test(x)) {
      if (/site.?id/i.test(k)) preferred.push(x); else if (/^id$/i.test(k)) fallback.push(x);
    }
    walk(x);
  }
};
for (const line of fs.readFileSync(process.env.OUT,'utf8').split(/\r?\n/).filter(Boolean)) { try { walk(JSON.parse(line)); } catch {} }
process.stdout.write(preferred[0] || fallback[0] || '');
NODE
}

find_regular_sandbox(){
  local out="$ROOT/dev-site-list.jsonl" err="$ROOT/dev-site-list.err" rc found
  set +e
  (cd "$PRODUCT" && timeout 120s npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site list --search "$SANDBOX_SITE_NAME") >"$out" 2>"$err"
  rc=$?
  set -e
  (( rc == 0 )) || return 1
  found="$(parse_site_id_from_list "$out")"
  [[ -n "$found" ]] || return 1
  site_id="$found"
  : >"$out"; : >"$err"
  return 0
}

create_regular_bookings_sandbox(){
  local response="$ROOT/regular-site-create.json" code body meta rc
  if find_regular_sandbox; then
    echo "::notice::Reusing existing Wix sandbox site $SANDBOX_SITE_NAME."
    return 0
  fi
  body="$(jq -nc --arg template "$BOOKINGS_SITE_TEMPLATE_ID" --arg name "$SANDBOX_SITE_NAME" '{originTemplateId:$template,siteName:$name}')"
  set +e
  code="$(curl -sS -o "$response" -w '%{http_code}' -X POST 'https://www.wixapis.com/msm/v1/meta-site/create-from-template' \
    -H "Authorization: $WIX_API_KEY" -H 'Content-Type: application/json' --data "$body")"
  rc=$?
  set -e
  if (( rc != 0 )) || [[ ! "$code" =~ ^2 ]]; then
    {
      echo "Regular Wix sandbox creation failed."
      echo "HTTP: $code"
      redact <"$response" | tail -n100
    } >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_site_creation_failure.txt"
    : >"$response"
    return 1
  fi
  meta="$(jq -r '.metaSiteId // .meta_site_id // .site.metaSiteId // empty' "$response" 2>/dev/null || true)"
  : >"$response"
  for _ in 1 2 3 4 5 6; do
    sleep 5
    if find_regular_sandbox; then return 0; fi
  done
  {
    echo "Wix regular sandbox was created but CLI could not resolve its site ID."
    echo "metaSiteId=${meta:-unknown}"
    echo "siteName=$SANDBOX_SITE_NAME"
  } >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_site_creation_failure.txt"
  return 1
}

# Keep a selected test-site ID in factory state so retries reuse one sandbox.
site_id=""
if [[ -f "$SITE_STATE" ]] && jq -e --arg app "$EXPECTED_WIX_APP_ID" '.appId==$app and (.siteId|type=="string" and length>0)' "$SITE_STATE" >/dev/null 2>&1; then
  site_id="$(jq -r .siteId "$SITE_STATE")"
fi

if [[ -z "$site_id" ]]; then
  set +e
  (cd "$PRODUCT" && timeout 240s npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site create --template dev) >"$ROOT/dev-site-create.jsonl" 2>"$ROOT/dev-site-create.err"
  dev_create_rc=$?
  set -e
  if (( dev_create_rc == 0 )); then
    site_id="$(parse_site_id_from_list "$ROOT/dev-site-create.jsonl")"
  else
    # `dev-site create` currently rejects API-key auth because the internal
    # Development Sites endpoint requires a Wix User ID. Wix's own current
    # management skill documents this account-level API fallback for regular
    # Wix sites. A normal site is valid here because `dev-site list/select`
    # explicitly supports all sites in the account, not just Development Sites.
    echo "::warning::Special Development Site creation unavailable to API-key auth; trying official regular Wix Bookings sandbox creation."
    if ! create_regular_bookings_sandbox; then
      redact <"$ROOT/dev-site-create.err" | tail -n120 >&2
      exit 42
    fi
  fi
  if [[ -z "$site_id" ]]; then
    echo "::error::Wix site creation completed but no site ID could be resolved." >&2
    redact <"$ROOT/dev-site-create.jsonl" | tail -n80 >&2
    exit 42
  fi
  jq -n --arg appId "$EXPECTED_WIX_APP_ID" --arg siteId "$site_id" --arg run "$GITHUB_RUN_ID" '{schemaVersion:1,appId:$appId,siteId:$siteId,createdByRun:$run}' >"$SITE_STATE"
fi

install_app(){
  local app_id="$1"
  local label="$2"
  local response="$ROOT/install-${label}.json"
  local code body curl_rc
  body="$(jq -nc --arg site "$site_id" --arg app "$app_id" '{tenant:{tenantType:"SITE",id:$site},appInstance:{appDefId:$app,enabled:true}}')"
  set +e
  code="$(curl -sS -o "$response" -w '%{http_code}' -X POST 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
    -H "Authorization: $WIX_API_KEY" -H "wix-site-id: $site_id" -H 'Content-Type: application/json' --data "$body")"
  curl_rc=$?
  set -e
  if (( curl_rc == 0 )) && [[ "$code" =~ ^2 ]]; then : >"$response"; return 0; fi
  if grep -Eqi 'already[^" ]*.*install|ALREADY_EXISTS|already exists' "$response" 2>/dev/null; then : >"$response"; return 0; fi
  body="$(jq -nc --arg site "$site_id" --arg app "$app_id" '{tenant:{tenantType:"SITE",id:$site},appInstance:{appDefId:$app,enabled:true},installType:"INSTALL_TYPE_SITE",appsInstallOptions:{}}')"
  set +e
  code="$(curl -sS -o "$response" -w '%{http_code}' -X POST 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
    -H "Authorization: $WIX_API_KEY" -H "wix-site-id: $site_id" -H 'Content-Type: application/json' --data "$body")"
  curl_rc=$?
  set -e
  if (( curl_rc == 0 )) && [[ "$code" =~ ^2 ]]; then : >"$response"; return 0; fi
  if grep -Eqi 'already[^" ]*.*install|ALREADY_EXISTS|already exists' "$response" 2>/dev/null; then : >"$response"; return 0; fi
  {
    echo "Install target: $label"
    echo "HTTP: $code"
    redact <"$response" | tail -n80
  } >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_dev_site_install_failure.txt"
  : >"$response"
  return 1
}

install_app "$BOOKINGS_APP_ID" bookings || exit 42
install_app "$EXPECTED_WIX_APP_ID" product || exit 42

set +e
(cd "$PRODUCT" && timeout 120s npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site select "$site_id") >"$ROOT/dev-site-select.log" 2>&1
select_rc=$?
set -e
if (( select_rc != 0 )); then
  echo "::error::Test site exists and apps were installed, but Wix CLI could not select it." >&2
  redact <"$ROOT/dev-site-select.log" | tail -n120 >&2
  exit 42
fi
: >"$ROOT/dev-site-select.log"

printf 'WIX_SITE_ID=%s\n' "$site_id" >"$PRODUCT/.env.local"
set +e
(cd "$PRODUCT" && timeout 120s npx -y "@wix/cli@${WIX_CLI_VERSION}" env pull) >"$ROOT/env-pull.log" 2>&1
env_rc=$?
set -e
if (( env_rc != 0 )) || ! grep -Eq '^WIX_CLIENT_ID=.+$' "$PRODUCT/.env.local"; then
  echo "::error::Wix test site exists but env pull did not provide WIX_CLIENT_ID." >&2
  redact <"$ROOT/env-pull.log" | tail -n120 >&2
  exit 42
fi
: >"$ROOT/env-pull.log"

jq -n --arg appId "$EXPECTED_WIX_APP_ID" --arg siteId "$site_id" --arg bookingsAppId "$BOOKINGS_APP_ID" \
  '{schemaVersion:1,appId:$appId,siteId:$siteId,bookingsAppId:$bookingsAppId,developmentSite:"READY",bookingsInstalled:true,productInstalled:true,wixClientEnvironmentPulled:true,secretsPersisted:false}' \
  >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_dev_site.json"

jq -n \
  --arg appId "$(jq -r .appId "$CONFIG")" \
  --arg projectId "$(jq -r .projectId "$CONFIG")" \
  --arg projectType "$(jq -r .projectType "$CONFIG")" \
  --arg createNewVersion "$CREATE_NEW_VERSION" \
  --arg wixCliVersion "$WIX_CLI_VERSION" \
  --argjson generatorExit "$create_rc" \
  --arg scaffoldPackageHash "$(sha256sum "$SCAFFOLD/package.json" | awk '{print $1}')" \
  '{schemaVersion:3,source:"authenticated official Wix existing-app scaffold",appId:$appId,projectId:$projectId,projectType:$projectType,createNewVersion:$createNewVersion,wixCliVersion:$wixCliVersion,generatorExit:$generatorExit,projectAcceptedDespiteOptionalPostTaskFailure:($generatorExit!=0),pristineWixBuild:"PASS",scaffoldPackageSha256:$scaffoldPackageHash,developmentSiteProvisioned:true,secretsPersisted:false}' \
  >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_official_scaffold.json"
