#!/usr/bin/env bash
set -Eeuo pipefail

PRODUCT="${1:?product worktree required}"
ROOT="${2:?scratch root required}"
: "${EXPECTED_WIX_APP_ID:?}" "${WIX_API_KEY:?}" "${WIX_CLI_VERSION:?}" "${GITHUB_WORKSPACE:?}" "${GITHUB_RUN_ID:?}"

CREATE_NEW_VERSION="0.0.105"
APP_NAME="Advanced Booking Rules"
mkdir -p "$ROOT"
PKG="$ROOT/pkg"
WORK="$ROOT/work"
mkdir -p "$PKG" "$WORK"

redact(){ sed -E 's/[A-Za-z0-9_=-]{40,}/[REDACTED]/g'; }

# Authenticate only in the ephemeral runner. No auth state is copied to the product.
set +e
npx -y "@wix/cli@${WIX_CLI_VERSION}" logout >/dev/null 2>&1
npx -y "@wix/cli@${WIX_CLI_VERSION}" login --api-key "$WIX_API_KEY" >"$ROOT/login.log" 2>&1
login_rc=$?
set -e
if (( login_rc != 0 )); then
  redact <"$ROOT/login.log" | tail -n80 >&2
  exit 42
fi
: >"$ROOT/login.log"

# Reuse the exact Wix existing-app scaffold primitive that already produced a
# successful real build for this App ID on 2026-08-26. The blank template is
# taken from the pinned official @wix/create-new package; no project identifiers
# or dependency versions are guessed by an LLM.
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
if (( create_rc != 0 )); then
  redact <"$ROOT/create.log" | tail -n160 >&2
  exit 43
fi
: >"$ROOT/create.log"

CONFIG="$(find "$WORK" -mindepth 2 -maxdepth 5 -type f -name wix.config.json -print -quit)"
[[ -n "$CONFIG" ]] || { echo "::error::Official Wix existing-app scaffold produced no wix.config.json." >&2; exit 3; }
SCAFFOLD="$(dirname "$CONFIG")"

jq -e --arg id "$EXPECTED_WIX_APP_ID" '
  type=="object" and .appId==$id and
  (.projectId|type=="string" and length>0) and
  (.projectType|type=="string" and length>0)
' "$CONFIG" >/dev/null
if jq -e 'paths(scalars) as $p | ($p|map(tostring)|join(".")) | test("secret|token|password|api.?key";"i")' "$CONFIG" >/dev/null; then
  echo "::error::Generated wix.config.json contains a secret-like field." >&2
  exit 4
fi
[[ -f "$SCAFFOLD/package.json" ]] || { echo "::error::Official scaffold has no package.json." >&2; exit 5; }
[[ -f "$SCAFFOLD/tsconfig.json" ]] || { echo "::error::Official scaffold has no tsconfig.json." >&2; exit 6; }
[[ -f "$SCAFFOLD/astro.config.mjs" ]] || { echo "::error::Official scaffold has no astro.config.mjs." >&2; exit 7; }
[[ -f "$SCAFFOLD/src/env.d.ts" ]] || { echo "::error::Official scaffold has no src/env.d.ts." >&2; exit 8; }

# First prove the untouched Wix-generated project itself still builds.
set +e
(
  cd "$SCAFFOLD"
  timeout 300s npx -y "@wix/cli@${WIX_CLI_VERSION}" build
) >"$ROOT/pristine-build.log" 2>&1
pristine_rc=$?
set -e
if (( pristine_rc != 0 )); then
  redact <"$ROOT/pristine-build.log" | tail -n160 >&2
  exit 44
fi
redact <"$ROOT/pristine-build.log" | tail -n120 >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_official_scaffold_pristine_build.txt"
: >"$ROOT/pristine-build.log"

# Wix owns these scaffold files. Copy them verbatim from the authenticated,
# build-proven generated project instead of synthesizing them.
cp "$CONFIG" "$PRODUCT/wix.config.json"
cp "$SCAFFOLD/astro.config.mjs" "$PRODUCT/astro.config.mjs"
mkdir -p "$PRODUCT/src"
cp "$SCAFFOLD/src/env.d.ts" "$PRODUCT/src/env.d.ts"
if [[ -f "$SCAFFOLD/extensions.ts" ]]; then
  cp "$SCAFFOLD/extensions.ts" "$PRODUCT/extensions.ts"
fi

# Merge package metadata deterministically: Wix-generated dependency versions and
# Wix lifecycle scripts win; the existing product keeps its tests/check scripts
# and its own metadata. This prevents guessed React/Wix peer combinations.
PRODUCT_PACKAGE="$PRODUCT/package.json" SCAFFOLD_PACKAGE="$SCAFFOLD/package.json" node <<'NODE'
const fs = require('fs');
const productPath = process.env.PRODUCT_PACKAGE;
const scaffoldPath = process.env.SCAFFOLD_PACKAGE;
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const scaffold = JSON.parse(fs.readFileSync(scaffoldPath, 'utf8'));
const wixScripts = ['build','dev','release','preview','logs','generate'];
const scripts = { ...(product.scripts || {}) };
for (const name of wixScripts) {
  if (scaffold.scripts && scaffold.scripts[name]) scripts[name] = scaffold.scripts[name];
}
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

# Keep the product's strict compiler policy while inheriting any Wix/Astro
# scaffold extends/includes required by the generated project.
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

# Re-resolve a lockfile from the merged package graph. The versions supplied by
# the official scaffold win where Wix/React packages overlap.
rm -f "$PRODUCT/package-lock.json"
(
  cd "$PRODUCT"
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund
)

jq -n \
  --arg appId "$(jq -r .appId "$CONFIG")" \
  --arg projectId "$(jq -r .projectId "$CONFIG")" \
  --arg projectType "$(jq -r .projectType "$CONFIG")" \
  --arg createNewVersion "$CREATE_NEW_VERSION" \
  --arg wixCliVersion "$WIX_CLI_VERSION" \
  --arg scaffoldPackageHash "$(sha256sum "$SCAFFOLD/package.json" | awk '{print $1}')" \
  '{schemaVersion:1,source:"authenticated official Wix existing-app scaffold",appId:$appId,projectId:$projectId,projectType:$projectType,createNewVersion:$createNewVersion,wixCliVersion:$wixCliVersion,pristineWixBuild:"PASS",scaffoldPackageSha256:$scaffoldPackageHash,secretsPersisted:false}' \
  >"$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_official_scaffold.json"
