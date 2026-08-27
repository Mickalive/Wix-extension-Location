#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${RUNNER_TEMP:?}" "${PRODUCT_BRANCH:?}"
: "${MAIN_PROMPT_SHA256:?}" "${EXPECTED_WIX_APP_ID:?}" "${CONTROL_PROTOCOL:?}" "${OX_MODEL:?}"

ROOT="${RUNNER_TEMP}/wix-factory-${GITHUB_RUN_ID}"
PRODUCT="${ROOT}/product"
EVIDENCE="${ROOT}/evidence"
META="${ROOT}/meta"
RESULT="${ROOT}/result.env"
BASE_FILE="${META}/base_sha"
ROLE_FILE="${META}/role"
GATE_FILE="${META}/gate"
WIX_FILE="${META}/wix"
PROMOTE_FILE="${META}/promote"
REASON_FILE="${META}/reason"
CYCLE="${CYCLE_INDEX:-1}"
[[ "$CYCLE" =~ ^[0-9]+$ ]] || CYCLE=1

mkdir -p "$ROOT" "$META" "$EVIDENCE"

write_result() {
  local verdict="$1" reason="$2" cycle="${3:-$CYCLE}"
  reason="${reason//$'\n'/ }"
  reason="${reason//\'/}"
  cat > "$RESULT" <<EOF
verdict='$verdict'
reason='$reason'
persisted_cycle='$cycle'
EOF
}

record_reason() {
  printf '%s\n' "$1" > "$REASON_FILE"
}

reason() {
  cat "$REASON_FILE" 2>/dev/null || echo unknown
}

set_gate() { printf '%s\n' "$1" > "$GATE_FILE"; }
gate() { cat "$GATE_FILE" 2>/dev/null || echo CLOSED; }
set_wix() { printf '%s\n' "$1" > "$WIX_FILE"; }
wix_state() { cat "$WIX_FILE" 2>/dev/null || echo NOT_RUN; }
set_promote() { printf '%s\n' "$1" > "$PROMOTE_FILE"; }
promote() { cat "$PROMOTE_FILE" 2>/dev/null || echo false; }

git_auth() {
  printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0
}

fetch_product() {
  local auth
  auth="$(git_auth)"
  git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $auth" \
    fetch --no-tags origin "+refs/heads/${PRODUCT_BRANCH}:refs/remotes/origin/${PRODUCT_BRANCH}"
}

overlay_control() {
  local cwd="$1"
  rm -rf "$cwd/.opencode/agents" "$cwd/.opencode/job-descriptions"
  mkdir -p "$cwd/.opencode"
  cp -a "$GITHUB_WORKSPACE/.opencode/agents" "$cwd/.opencode/agents"
  cp -a "$GITHUB_WORKSPACE/.opencode/job-descriptions" "$cwd/.opencode/job-descriptions"
  cp "$GITHUB_WORKSPACE/AGENTS.md" "$cwd/AGENTS.md"
  (cd "$cwd" && sha256sum --check --strict .opencode/job-descriptions/MANIFEST.sha256 >/dev/null)
}

restore_control() {
  local cwd="$1"
  rm -rf "$cwd/.opencode/agents" "$cwd/.opencode/job-descriptions"
  git -C "$cwd" checkout HEAD -- .opencode/agents .opencode/job-descriptions AGENTS.md >/dev/null 2>&1 || true
  git -C "$cwd" clean -fd -- .opencode/agents .opencode/job-descriptions AGENTS.md >/dev/null 2>&1 || true
}

run_agent() {
  local cwd="$1" agent="$2" label="$3" prompt="$4"
  local log="${ROOT}/${label}.log"
  local attempt rc
  if ! command -v opencode >/dev/null 2>&1; then
    echo "OpenCode is unavailable." | tee "$log"
    return 75
  fi
  for attempt in 1 2; do
    echo "OpenCode $label attempt $attempt/2."
    overlay_control "$cwd"
    set +e
    (cd "$cwd" && opencode run --model "$OX_MODEL" --agent "$agent" "$prompt") 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    set -e
    restore_control "$cwd"
    (( rc == 0 )) && return 0
    grep -Eqi 'Unexpected server error|UnknownError|err_[A-Za-z0-9_-]+|network error|temporarily unavailable|service unavailable|provider unavailable|ECONNRESET|ETIMEDOUT|timed out|rate.?limit|HTTP[^0-9]*(429|500|502|503|504)' "$log" || return "$rc"
    (( attempt == 2 )) || sleep 45
  done
  return 75
}

safe_excerpt() {
  local src="$1"
  tail -n 50 "$src" 2>/dev/null |
    sed -E 's/(token|secret|password|api[_ -]?key)[=: ][^ ]+/\1=[REDACTED]/Ig' |
    head -c 6000
}

copy_evidence_out() {
  rm -rf "$EVIDENCE"
  mkdir -p "$EVIDENCE"
  if [[ -d "$PRODUCT/reports" ]]; then
    cp -a "$PRODUCT/reports" "$EVIDENCE/reports"
  fi
}

restore_evidence() {
  if [[ -d "$EVIDENCE/reports" ]]; then
    mkdir -p "$PRODUCT/reports"
    cp -a "$EVIDENCE/reports/." "$PRODUCT/reports/"
    git -C "$PRODUCT" add -A reports 2>/dev/null || true
  fi
}

reset_product_to_base() {
  local base
  base="$(cat "$BASE_FILE")"
  copy_evidence_out
  git -C "$PRODUCT" reset --hard "$base" >/dev/null
  git -C "$PRODUCT" clean -fd >/dev/null
  restore_evidence
}

validate_scope() {
  local role="$1" bad=0 path
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      .env|.env.*|*/.env|*/.env.*|*.key|*.pem|*.p8|*.p12|*credentials*|.wix/*)
        echo "::error::Credential-like file forbidden: $path"; bad=1; continue ;;
    esac
    case "$role:$path" in
      integration:package.json|integration:package-lock.json|integration:tsconfig.json|integration:astro.config.mjs|integration:extensions.ts|integration:wix.config.json|integration:wix.config.example.json|integration:.gitignore|integration:vite.config.*|integration:vitest.config.*|integration:eslint.config.*|integration:src/env.d.ts|integration:src/platform/*|integration:src/platform/**|integration:src/extensions/backend/*|integration:src/extensions/backend/**|integration:tests/platform/*|integration:tests/platform/**) ;;
      rules:src/domain/*|rules:src/domain/**|rules:tests/domain/*|rules:tests/domain/**) ;;
      dashboard:src/extensions/dashboard/*|dashboard:src/extensions/dashboard/**|dashboard:src/ui/*|dashboard:src/ui/**|dashboard:tests/ui/*|dashboard:tests/ui/**) ;;
      billing:src/billing/*|billing:src/billing/**|billing:tests/billing/*|billing:tests/billing/**) ;;
      *) echo "::error::Out-of-lane product path: $path"; bad=1 ;;
    esac
  done < <(git -C "$PRODUCT" status --porcelain=v1 | sed -E 's/^.. //; s/.* -> //')
  (( bad == 0 ))
}

deterministic_checks() {
  (
    cd "$PRODUCT"
    npm ci --ignore-scripts --no-audit --no-fund &&
    npm run check &&
    npm run build
  )
}

# Builder product changes are staged. Every later agent is read/audit/planning-only for
# product code. Any unstaged non-allowed path means the agent crossed its authority.
enforce_unstaged_scope() {
  local label="$1"; shift
  local bad=0 path allowed pattern
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    allowed=0
    for pattern in "$@"; do
      case "$path" in $pattern) allowed=1; break ;; esac
    done
    if (( allowed == 0 )); then
      echo "::error::$label modified forbidden path: $path"
      if git -C "$PRODUCT" ls-files --error-unmatch "$path" >/dev/null 2>&1; then
        git -C "$PRODUCT" restore --worktree -- "$path" >/dev/null 2>&1 || true
      else
        rm -rf -- "$PRODUCT/$path"
      fi
      bad=1
    fi
  done < <({
    git -C "$PRODUCT" diff --name-only
    git -C "$PRODUCT" ls-files --others --exclude-standard
  } | sort -u)
  (( bad == 0 ))
}

enforce_audit_worktree_scope() {
  local dir="$1" allowed="$2" bad=0 path
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      "$allowed") ;;
      *)
        echo "::error::Independent auditor modified forbidden path: $path"
        bad=1 ;;
    esac
  done < <({
    git -C "$dir" diff --name-only
    git -C "$dir" ls-files --others --exclude-standard
  } | sort -u)
  (( bad == 0 ))
}

prepare() {
  rm -rf "$ROOT"
  mkdir -p "$META" "$EVIDENCE"
  write_result CONTINUE prepare_started "$CYCLE"
  set_gate CLOSED
  set_wix NOT_RUN
  set_promote false

  printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | (cd "$GITHUB_WORKSPACE" && sha256sum --check --strict)
  (cd "$GITHUB_WORKSPACE" && sha256sum --check --strict .opencode/job-descriptions/MANIFEST.sha256)

  fetch_product
  local base
  base="$(git -C "$GITHUB_WORKSPACE" rev-parse "refs/remotes/origin/${PRODUCT_BRANCH}")"
  printf '%s\n' "$base" > "$BASE_FILE"
  git -C "$GITHUB_WORKSPACE" worktree add --detach "$PRODUCT" "$base" >/dev/null

  printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | (cd "$PRODUCT" && sha256sum --check --strict)
  jq -e '.lanes and (.lanes|type=="object")' "$PRODUCT/docs/NEXT_CYCLE.json" >/dev/null

  local active_count role
  active_count="$(jq '[.lanes | to_entries[] | select(.value.status=="active")] | length' "$PRODUCT/docs/NEXT_CYCLE.json")"
  if (( active_count > 1 )); then
    record_reason "invalid_plan_multiple_active_lanes"
    printf 'none\n' > "$ROLE_FILE"
    return 0
  fi
  role="$(jq -r '[.lanes | to_entries[] | select(.value.status=="active") | .key][0] // "none"' "$PRODUCT/docs/NEXT_CYCLE.json")"
  case "$role" in integration|rules|dashboard|billing|none) ;; *) role=none; record_reason "invalid_plan_unknown_lane" ;; esac
  printf '%s\n' "$role" > "$ROLE_FILE"
  record_reason "prepared_${role}"
  echo "Accepted product lease: $base; selected lane: $role"
}

build() {
  [[ -f "$BASE_FILE" && -e "$PRODUCT/.git" ]] || {
    record_reason "prepare_failed"; write_result CONTINUE prepare_failed "$CYCLE"; return 0;
  }
  local base role agent directive task why evidence criteria rc report verdict
  base="$(cat "$BASE_FILE")"
  role="$(cat "$ROLE_FILE" 2>/dev/null || echo none)"

  if [[ "$(reason)" == invalid_plan_* ]]; then
    mkdir -p "$PRODUCT/reports/factory"
    cat > "$PRODUCT/reports/factory/CYCLE_${GITHUB_RUN_ID}.md" <<EOF
# Factory invariant finding
The accepted plan contains more than one active lane or an invalid lane. Protocol v4 permits at most one mutable lane per cycle.
VERDICT: CONTINUE
EOF
    return 0
  fi

  if [[ "$role" != none ]]; then
    case "$role" in
      integration) agent=wix-integration-builder; directive=directives/INTEGRATION.md ;;
      rules) agent=rules-engine-builder; directive=directives/RULES.md ;;
      dashboard) agent=dashboard-builder; directive=directives/DASHBOARD.md ;;
      billing) agent=billing-builder; directive=directives/BILLING.md ;;
    esac
    task="$(jq -r --arg r "$role" '.lanes[$r].task // ""' "$PRODUCT/docs/NEXT_CYCLE.json")"
    why="$(jq -r --arg r "$role" '.lanes[$r].why_needed // ""' "$PRODUCT/docs/NEXT_CYCLE.json")"
    evidence="$(jq -c --arg r "$role" '.lanes[$r].source_evidence // []' "$PRODUCT/docs/NEXT_CYCLE.json")"
    criteria="$(jq -c --arg r "$role" '.lanes[$r].acceptance_criteria // []' "$PRODUCT/docs/NEXT_CYCLE.json")"
    set +e
    run_agent "$PRODUCT" "$agent" "builder-${role}" \
      "Product Factory protocol v4, run $GITHUB_RUN_ID, cycle $CYCLE. Work only on lane $role from accepted SHA $base. Read your immutable role fiche, MAIN_PROMPT.md, AGENTS.md, docs/WIX_TECHNICAL_CONTRACT.md, docs/BUILD_BLUEPRINT.md, $directive and docs/NEXT_CYCLE.json. Exact task: $task. Why: $why. Evidence: $evidence. Criteria: $criteria. Repair the evidenced blocker only. Do not edit governance, reports, other lanes, workflow files, state files, or git history. Do not commit or push. Never inspect secrets."
    rc=$?
    set -e
    if (( rc != 0 )); then
      record_reason "builder_${role}_unavailable_or_failed"
      reset_product_to_base
      mkdir -p "$PRODUCT/reports/factory"
      printf '# Builder failure\nLane: %s\nExit: %s\nVERDICT: CONTINUE\n' "$role" "$rc" > "$PRODUCT/reports/factory/CYCLE_${GITHUB_RUN_ID}.md"
      return 0
    fi

    if ! validate_scope "$role"; then
      record_reason "builder_${role}_scope_violation"
      reset_product_to_base
      return 0
    fi

    # Capture all builder changes, including untracked files, as an immutable local patch.
    (cd "$PRODUCT" && git add -A && git diff --cached --binary > "$ROOT/candidate.patch")
    git -C "$GITHUB_WORKSPACE" worktree add --detach "$ROOT/audit" "$base" >/dev/null
    if [[ -s "$ROOT/candidate.patch" ]]; then
      (cd "$ROOT/audit" && git apply --index "$ROOT/candidate.patch")
    fi
    mkdir -p "$ROOT/audit/reports/audits"
    report="$ROOT/audit/reports/audits/CYCLE_${GITHUB_RUN_ID}_${role^^}.md"
    set +e
    run_agent "$ROOT/audit" lane-auditor "audit-${role}" \
      "Independently audit the immutable $role candidate for Product Factory run $GITHUB_RUN_ID against accepted SHA $base and the exact task in docs/NEXT_CYCLE.json. Do not repair product code. Inspect the diff, tests, architecture and acceptance criteria. Write only reports/audits/CYCLE_${GITHUB_RUN_ID}_${role^^}.md ending exactly VERDICT: ACCEPT, VERDICT: FIX_BEFORE_INTEGRATION, or VERDICT: REJECT."
    rc=$?
    set -e
    if (( rc != 0 )) || [[ ! -f "$report" ]]; then
      record_reason "audit_${role}_unavailable_or_failed"
      reset_product_to_base
      return 0
    fi
    if ! enforce_audit_worktree_scope "$ROOT/audit" "reports/audits/CYCLE_${GITHUB_RUN_ID}_${role^^}.md"; then
      record_reason "audit_${role}_scope_violation"
      reset_product_to_base
      return 0
    fi
    verdict="$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')"
    mkdir -p "$PRODUCT/reports/audits"
    cp "$report" "$PRODUCT/reports/audits/"
    git -C "$PRODUCT" add -A "reports/audits/CYCLE_${GITHUB_RUN_ID}_${role^^}.md"
    if [[ "$verdict" != ACCEPT ]]; then
      record_reason "audit_${role}_${verdict:-invalid}"
      reset_product_to_base
      return 0
    fi
  fi

  set +e
  deterministic_checks >"$ROOT/deterministic.log" 2>&1
  rc=$?
  set -e
  if (( rc != 0 )); then
    mkdir -p "$PRODUCT/reports/integration"
    {
      echo "# Deterministic preview failure"
      echo '```'
      safe_excerpt "$ROOT/deterministic.log"
      echo '```'
      echo "VERDICT: FIX_BEFORE_INTEGRATION"
    } > "$PRODUCT/reports/integration/CYCLE_${GITHUB_RUN_ID}.md"
    record_reason "deterministic_preview_failed"
    return 0
  fi

  mkdir -p "$PRODUCT/reports/simulation"
  set +e
  run_agent "$PRODUCT" wix-simulation-auditor simulation \
    "Adversarially simulate the exact integrated candidate for Product Factory run $GITHUB_RUN_ID. Do not modify product code. Stress unsafe transitions, authorization boundaries, rule composition, malformed inputs, partial Wix failures, entitlement drift and rollback. Write only reports/simulation/CYCLE_${GITHUB_RUN_ID}.md and reports/simulation/CYCLE_${GITHUB_RUN_ID}.json. The markdown must end exactly VERDICT: PASS, VERDICT: FAIL, or VERDICT: INCONCLUSIVE."
  rc=$?
  set -e
  report="$PRODUCT/reports/simulation/CYCLE_${GITHUB_RUN_ID}.md"
  if ! enforce_unstaged_scope simulation "reports/simulation/CYCLE_${GITHUB_RUN_ID}.md" "reports/simulation/CYCLE_${GITHUB_RUN_ID}.json"; then
    record_reason "simulation_scope_violation"
    return 0
  fi
  if (( rc != 0 )) || [[ ! -f "$report" ]]; then
    record_reason "simulation_unavailable_or_failed"
    return 0
  fi
  verdict="$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')"
  git -C "$PRODUCT" add -A "reports/simulation/CYCLE_${GITHUB_RUN_ID}.md" "reports/simulation/CYCLE_${GITHUB_RUN_ID}.json" 2>/dev/null || true
  if [[ "$verdict" != PASS ]]; then
    record_reason "simulation_${verdict:-invalid}"
    return 0
  fi

  mkdir -p "$PRODUCT/reports/audits"
  report="$PRODUCT/reports/audits/CYCLE_${GITHUB_RUN_ID}_INTEGRATED.md"
  set +e
  run_agent "$PRODUCT" lane-auditor integrated-audit \
    "Independently audit the complete integrated candidate for Product Factory run $GITHUB_RUN_ID after deterministic checks and adversarial simulation. This is a cross-system audit, not a builder. Do not modify product code. Verify all lane boundaries and the current Wix technical contract. Write only reports/audits/CYCLE_${GITHUB_RUN_ID}_INTEGRATED.md ending exactly VERDICT: ACCEPT, VERDICT: FIX_BEFORE_INTEGRATION, or VERDICT: REJECT."
  rc=$?
  set -e
  if ! enforce_unstaged_scope integrated-audit "reports/audits/CYCLE_${GITHUB_RUN_ID}_INTEGRATED.md"; then
    record_reason "integrated_audit_scope_violation"
    return 0
  fi
  if (( rc != 0 )) || [[ ! -f "$report" ]]; then
    record_reason "integrated_audit_unavailable_or_failed"
    return 0
  fi
  verdict="$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')"
  git -C "$PRODUCT" add -A "reports/audits/CYCLE_${GITHUB_RUN_ID}_INTEGRATED.md"
  if [[ "$verdict" != ACCEPT ]]; then
    record_reason "integrated_audit_${verdict:-invalid}"
    return 0
  fi

  set_gate WIX_ELIGIBLE
  record_reason "pre_wix_gates_passed"
}

wix_live() {
  [[ -f "$BASE_FILE" ]] || return 0
  [[ "$(gate)" == WIX_ELIGIBLE ]] || return 0
  mkdir -p "$PRODUCT/reports/wix-live"
  local report="$PRODUCT/reports/wix-live/CYCLE_${GITHUB_RUN_ID}.md" rc

  if [[ ! -f "$PRODUCT/wix.config.json" ]] ||
     [[ "$(jq -r '.appId // empty' "$PRODUCT/wix.config.json" 2>/dev/null || true)" != "$EXPECTED_WIX_APP_ID" ]]; then
    cat > "$report" <<EOF
# Wix Live QA
Candidate is not bound to the expected existing Wix app $EXPECTED_WIX_APP_ID.
Owning lane: integration.
VERDICT: FIX_BEFORE_INTEGRATION
EOF
    set_wix FIX_BEFORE_INTEGRATION
    record_reason "wix_binding_invalid"
    return 0
  fi

  if [[ -z "${WIX_API_KEY:-}" ]]; then
    cat > "$report" <<'EOF'
# Wix Live QA
Wix API key is unavailable to the privileged CI step. No secret was exposed to an agent.
VERDICT: BLOCKED_EXTERNAL
EOF
    set_wix BLOCKED_EXTERNAL
    record_reason "wix_secret_unavailable"
    return 0
  fi

  set +e
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" login --api-key "$WIX_API_KEY") >"$ROOT/wix-login.log" 2>&1
  rc=$?
  set -e
  : > "$ROOT/wix-login.log"
  if (( rc != 0 )); then
    cat > "$report" <<'EOF'
# Wix Live QA
Wix CLI authentication failed in the privileged step. The secret was neither logged nor exposed to OpenCode.
VERDICT: BLOCKED_EXTERNAL
EOF
    set_wix BLOCKED_EXTERNAL
    record_reason "wix_authentication_failed"
    return 0
  fi

  set +e
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" build) >"$ROOT/wix-build.log" 2>&1
  rc=$?
  set -e
  if (( rc != 0 )); then
    {
      echo "# Wix Live QA"
      echo "Real wix build failed. Owning lane: integration."
      echo '```'
      safe_excerpt "$ROOT/wix-build.log"
      echo '```'
      echo "VERDICT: FIX_BEFORE_INTEGRATION"
    } > "$report"
    set_wix FIX_BEFORE_INTEGRATION
    record_reason "real_wix_build_failed"
    return 0
  fi

  set +e
  (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site list) >"$ROOT/wix-dev-list.log" 2>&1
  rc=$?
  if (( rc == 0 )); then
    (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site current) >"$ROOT/wix-current.log" 2>&1
    rc=$?
  fi
  if (( rc != 0 )); then
    (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site create --select) >"$ROOT/wix-current.log" 2>&1
    rc=$?
  fi
  set -e
  if (( rc != 0 )); then
    {
      echo "# Wix Live QA"
      echo "Development Site resolution is currently unavailable; recheck without broadening permissions."
      echo '```'
      safe_excerpt "$ROOT/wix-current.log"
      echo '```'
      echo "VERDICT: BLOCKED_EXTERNAL"
    } > "$report"
    set_wix BLOCKED_EXTERNAL
    record_reason "wix_dev_site_unavailable"
    return 0
  fi

  if ! enforce_unstaged_scope wix-cli "reports/wix-live/CYCLE_${GITHUB_RUN_ID}.md"; then
    cat > "$report" <<'EOF'
# Wix Live QA
The Wix CLI mutated source-controlled product files during live validation. This candidate is not admissible.
VERDICT: FIX_BEFORE_INTEGRATION
EOF
    set_wix FIX_BEFORE_INTEGRATION
    record_reason "wix_cli_mutated_source"
    return 0
  fi

  cat > "$report" <<EOF
# Wix Live deterministic QA
Expected app binding: $EXPECTED_WIX_APP_ID
Real wix build: PASS
Development Site resolution: PASS
MCP audit is the next gate.
VERDICT: PENDING_MCP
EOF
  git -C "$PRODUCT" add -A "$report"
  set_wix READY_FOR_MCP
  record_reason "wix_cli_passed"
}

wix_mcp() {
  [[ -f "$BASE_FILE" ]] || return 0
  [[ "$(wix_state)" == READY_FOR_MCP ]] || return 0
  local report="$PRODUCT/reports/wix-live/CYCLE_${GITHUB_RUN_ID}.md" rc verdict
  set +e
  run_agent "$PRODUCT" release-readiness-auditor wix-mcp \
    "WIX LIVE MODE for Product Factory run $GITHUB_RUN_ID. Wix CLI is already authenticated by a privileged prior step and a Development Site was resolved. Never inspect environment secrets, ~/.wix, tokens or auth files. Use Wix MCP for empirical evidence. Prefer reads. Never publish, release, submit, delete apps/sites, manage billing/domains/team/org, or operate on production. Reversible OX_QA_ mutation probes are allowed only on the positively identified Development Site when indispensable. Verify real scaffold recognition, Bookings locations/services/schedules contracts, validation-extension assumptions, dashboard compatibility, permissions, entitlement inputs, webhook assumptions where testable, mutation rollback and secret isolation. Do not modify product code. Replace reports/wix-live/CYCLE_${GITHUB_RUN_ID}.md and end exactly VERDICT: ACCEPT, VERDICT: FIX_BEFORE_INTEGRATION, or VERDICT: BLOCKED_EXTERNAL."
  rc=$?
  set -e
  if ! enforce_unstaged_scope wix-mcp "reports/wix-live/CYCLE_${GITHUB_RUN_ID}.md"; then
    set_wix FIX_BEFORE_INTEGRATION
    record_reason "wix_mcp_scope_violation"
    return 0
  fi
  if (( rc != 0 )) || [[ ! -f "$report" ]]; then
    set_wix BLOCKED_EXTERNAL
    record_reason "wix_mcp_unavailable_or_failed"
    return 0
  fi
  verdict="$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')"
  git -C "$PRODUCT" add -A "$report"
  case "$verdict" in
    ACCEPT) set_wix ACCEPT; set_promote true; record_reason "wix_live_accept" ;;
    FIX_BEFORE_INTEGRATION) set_wix FIX_BEFORE_INTEGRATION; record_reason "wix_mcp_fix" ;;
    BLOCKED_EXTERNAL) set_wix BLOCKED_EXTERNAL; record_reason "wix_mcp_blocked_external" ;;
    *) set_wix BLOCKED_EXTERNAL; record_reason "wix_mcp_invalid_verdict" ;;
  esac
}

finish() {
  [[ -f "$BASE_FILE" ]] || { write_result CONTINUE prepare_failed "$CYCLE"; return 0; }
  local base remote_before rc report final_verdict next_cycle current_cycle final_reason
  base="$(cat "$BASE_FILE")"

  # Only a candidate that passed every deterministic, adversarial, integrated and Wix-live gate may advance product code.
  if [[ "$(promote)" != true ]]; then
    reset_product_to_base
  fi

  mkdir -p "$PRODUCT/reports/director" "$PRODUCT/reports/release" "$PRODUCT/reports/factory"
  set +e
  run_agent "$PRODUCT" wix-build-director director \
    "Plan the next product cycle from the evidence of Product Factory run $GITHUB_RUN_ID. You have no terminal authority. READY is forbidden in Director output. BLOCKED_EXTERNAL means safe recheck; stagnation means change repair hypothesis; negative audits route to their owning lane. Protocol v4 permits at most ONE active mutable lane per cycle. Read all fresh reports under reports/. Update only docs/NEXT_CYCLE.json, docs/PRODUCT_GATES.json and reports/director/. Set docs/NEXT_CYCLE.json decision to continue unless it is merely describing release-candidate evidence for the independent final auditor. Never stop, cap cycles, edit product code, orchestration, or secrets. Recovery note: ${RECOVERY_NOTE:-none}"
  rc=$?
  set -e
  if ! enforce_unstaged_scope director 'reports/director/*' 'docs/NEXT_CYCLE.json' 'docs/PRODUCT_GATES.json'; then
    record_reason "director_scope_violation"
    rc=1
  fi
  if (( rc != 0 )); then
    record_reason "director_unavailable_or_failed"
  else
    # The Director may plan, but it cannot create another parallel lane machine.
    if [[ -f "$PRODUCT/docs/NEXT_CYCLE.json" ]]; then
      local active_count
      active_count="$(jq '[.lanes | to_entries[] | select(.value.status=="active")] | length' "$PRODUCT/docs/NEXT_CYCLE.json" 2>/dev/null || echo 99)"
      if (( active_count > 1 )); then
        record_reason "director_invalid_multiple_active_lanes"
        git -C "$PRODUCT" checkout "$base" -- docs/NEXT_CYCLE.json docs/PRODUCT_GATES.json 2>/dev/null || true
      fi
    fi
  fi

  git -C "$PRODUCT" add -A docs/NEXT_CYCLE.json docs/PRODUCT_GATES.json reports/director 2>/dev/null || true

  report="$PRODUCT/reports/release/CYCLE_${GITHUB_RUN_ID}.md"
  set +e
  run_agent "$PRODUCT" release-readiness-auditor final-release \
    "FINAL INDEPENDENT RELEASE AUDIT for Product Factory run $GITHUB_RUN_ID. The Director is advisory and cannot stop the factory. Inspect the actual current product, deterministic evidence, simulation, integrated audit, Wix Live/MCP evidence, technical contract and product gates. Do not modify product code or planning files. Write only reports/release/CYCLE_${GITHUB_RUN_ID}.md ending exactly VERDICT: READY or VERDICT: NOT_READY. READY is allowed only with direct evidence for every required gate, PASS simulation, ACCEPT integrated audit, ACCEPT Wix Live/MCP, correct app binding $EXPECTED_WIX_APP_ID, and no unresolved repair. Otherwise explain the owning repair and emit NOT_READY."
  rc=$?
  set -e
  if ! enforce_unstaged_scope final-auditor "reports/release/CYCLE_${GITHUB_RUN_ID}.md"; then
    record_reason "final_auditor_scope_violation"
    rc=1
  fi
  if (( rc != 0 )) || [[ ! -f "$report" ]]; then
    final_verdict=NOT_READY
    record_reason "final_auditor_unavailable_or_failed"
  else
    final_verdict="$(tail -n 1 "$report" | sed -n 's/^VERDICT: //p')"
    [[ "$final_verdict" == READY || "$final_verdict" == NOT_READY ]] || {
      final_verdict=NOT_READY
      record_reason "final_auditor_invalid_verdict"
    }
  fi

  git -C "$PRODUCT" add -A "$report" 2>/dev/null || true

  # A final auditor may produce READY; deterministic code can only reject an unsupported READY, never manufacture one.
  if [[ "$final_verdict" == READY && "$(promote)" == true && "$(wix_state)" == ACCEPT && "$(gate)" == WIX_ELIGIBLE ]]; then
    jq -n \
      --arg verdict READY \
      --arg app_id "$EXPECTED_WIX_APP_ID" \
      --arg protocol "$CONTROL_PROTOCOL" \
      --arg control_sha "$GITHUB_SHA" \
      --argjson run_id "$GITHUB_RUN_ID" \
      '{verdict:$verdict,app_id:$app_id,protocol:$protocol,control_sha:$control_sha,run_id:$run_id}' \
      > "$PRODUCT/reports/release/READY.json"
    final_reason="independent_final_audit_ready"
  else
    rm -f "$PRODUCT/reports/release/READY.json"
    final_verdict=NOT_READY
    final_reason="$(reason)"
  fi

  current_cycle="$(jq -r '.cycle // 0' "$PRODUCT/docs/state.json" 2>/dev/null || echo 0)"
  [[ "$current_cycle" =~ ^[0-9]+$ ]] || current_cycle=0
  next_cycle="$CYCLE"
  (( next_cycle > current_cycle )) || next_cycle=$((current_cycle + 1))
  jq -n \
    --arg phase "$([[ "$final_verdict" == READY ]] && echo ready || echo build)" \
    --arg protocol "$CONTROL_PROTOCOL" \
    --arg control_sha "$GITHUB_SHA" \
    --arg result "$final_verdict" \
    --arg reason "$final_reason" \
    --argjson cycle "$next_cycle" \
    --argjson run "$GITHUB_RUN_ID" \
    --arg promote "$(promote)" \
    '{phase:$phase,cycle:$cycle,protocol:$protocol,control_sha:$control_sha,last_factory_run:$run,last_result:$result,last_reason:$reason,product_promoted:($promote=="true")}' \
    > "$PRODUCT/docs/state.json"

  mkdir -p "$PRODUCT/reports/factory"
  jq -n \
    --arg protocol "$CONTROL_PROTOCOL" \
    --arg base_sha "$base" \
    --arg control_sha "$GITHUB_SHA" \
    --arg role "$(cat "$ROLE_FILE" 2>/dev/null || echo none)" \
    --arg gate "$(gate)" \
    --arg wix "$(wix_state)" \
    --arg promoted "$(promote)" \
    --arg final "$final_verdict" \
    --arg reason "$final_reason" \
    --argjson run "$GITHUB_RUN_ID" \
    '{protocol:$protocol,run_id:$run,base_sha:$base_sha,control_sha:$control_sha,role:$role,pre_wix_gate:$gate,wix_live:$wix,product_promoted:($promoted=="true"),final:$final,reason:$reason}' \
    > "$PRODUCT/reports/factory/CYCLE_${GITHUB_RUN_ID}.json"

  # Single compare-and-swap persistence. No force push and no ephemeral branch.
  fetch_product
  remote_before="$(git -C "$GITHUB_WORKSPACE" rev-parse "refs/remotes/origin/${PRODUCT_BRANCH}")"
  if [[ "$remote_before" != "$base" ]]; then
    write_result CONTINUE lease_lost "$current_cycle"
    echo "Accepted state changed from $base to $remote_before; refusing stale persistence."
    return 0
  fi

  git -C "$PRODUCT" config user.name "wix-product-factory"
  git -C "$PRODUCT" config user.email "wix-product-factory@users.noreply.github.com"
  git -C "$PRODUCT" add -A
  git -C "$PRODUCT" commit --allow-empty -m "Factory v4 cycle ${next_cycle}: ${final_verdict} (${GITHUB_RUN_ID})" >/dev/null
  local auth
  auth="$(git_auth)"
  if ! git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $auth" \
      push origin "HEAD:refs/heads/${PRODUCT_BRANCH}" >/dev/null 2>&1; then
    write_result CONTINUE atomic_push_rejected "$current_cycle"
    return 0
  fi

  if [[ "$final_verdict" == READY ]]; then
    write_result READY "$final_reason" "$next_cycle"
  else
    write_result CONTINUE "$final_reason" "$next_cycle"
  fi
  echo "Persisted one atomic accepted-state commit for cycle $next_cycle; final=$final_verdict."
}

cmd="${1:-}"
case "$cmd" in
  prepare) prepare ;;
  build) build ;;
  wix-live) wix_live ;;
  wix-mcp) wix_mcp ;;
  finish) finish ;;
  *) echo "usage: $0 {prepare|build|wix-live|wix-mcp|finish}" >&2; exit 64 ;;
esac
