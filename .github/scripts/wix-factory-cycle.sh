#!/usr/bin/env bash
set -Eeuo pipefail

: "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_WORKSPACE:?}" "${RUNNER_TEMP:?}"
: "${PRODUCT_BRANCH:?}" "${OX_BUILDER_MODELS:?}" "${OX_REVIEW_MODELS:?}" "${MAIN_PROMPT_SHA256:?}" "${EXPECTED_WIX_APP_ID:?}" "${GH_TOKEN:?}"

STATE="$GITHUB_WORKSPACE/.factory/state.json"
ROOT="$RUNNER_TEMP/wix-factory-$GITHUB_RUN_ID"
PRODUCT="$ROOT/product"
PRODUCT_REF="refs/remotes/origin/$PRODUCT_BRANCH"
mkdir -p "$ROOT" "$GITHUB_WORKSPACE/.factory/evidence"

log(){ printf '[factory] %s\n' "$*"; }
die(){ printf '::error::%s\n' "$*"; exit 1; }
auth(){ printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0; }
sget(){ jq -r "$1" "$STATE"; }
sedit(){ local t="$ROOT/state.json"; jq "$@" "$STATE" > "$t" && mv "$t" "$STATE"; }

fetch_product(){
  git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" fetch --prune --tags origin "+refs/heads/$PRODUCT_BRANCH:$PRODUCT_REF" >/dev/null
}
remote_main(){ git -C "$GITHUB_WORKSPACE" ls-remote origin refs/heads/main | awk '{print $1}'; }

persist(){
  local before="$1"
  git -C "$GITHUB_WORKSPACE" config user.name wix-factory-control
  git -C "$GITHUB_WORKSPACE" config user.email wix-factory-control@users.noreply.github.com
  git -C "$GITHUB_WORKSPACE" add .factory
  git -C "$GITHUB_WORKSPACE" diff --cached --quiet && return 0
  git -C "$GITHUB_WORKSPACE" commit -m "factory: $(sget '.phase') generation $(sget '.generation') run $GITHUB_RUN_ID" >/dev/null
  [[ "$(remote_main)" == "$before" ]] || die "control plane moved; refusing stale state push"
  git -C "$GITHUB_WORKSPACE" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin HEAD:refs/heads/main >/dev/null
}

transition(){
  sedit --arg p "$1" --arg r "$2" --argjson run "$GITHUB_RUN_ID" '.phase=$p|.generation+=1|.last_transition={reason:$r,run_id:$run}|.last_run=$run|.last_operational_failure=null|.lease=null'
}
opfail(){
  sedit --arg p "$1" --arg r "$2" --argjson run "$GITHUB_RUN_ID" '.last_run=$run|.last_operational_failure={phase:$p,reason:$r,run_id:$run}|.lease=null'
}
provider_failure(){
  grep -Eqi 'Unexpected server error|UnknownError|network error|temporarily unavailable|service unavailable|provider unavailable|ECONNRESET|ETIMEDOUT|timed out|rate.?limit|HTTP[^0-9]*(401|403|404|408|409|429|500|502|503|504)|Forbidden|model[^[:alnum:]]*(not found|unavailable|unsupported|invalid)|unknown model|no such model' "$1" 2>/dev/null
}
parse_verdict(){
  local report="$1"
  tail -n20 "$report" \
    | tr -d '\r' \
    | sed -nE 's/^[[:space:]>*_`~.-]*VERDICT:[[:space:]]*(ACCEPT|FIX|BLOCKED_EXTERNAL|READY|NOT_READY)[[:space:]*_`~.-]*$/\1/Ip' \
    | tail -n1 \
    | tr '[:lower:]' '[:upper:]'
}

prepare(){
  local ref="$1"
  rm -rf "$PRODUCT"
  git -C "$GITHUB_WORKSPACE" worktree add --detach "$PRODUCT" "$ref" >/dev/null
  printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | (cd "$PRODUCT" && sha256sum --check --strict)
}
overlay_control(){
  rm -rf "$PRODUCT/.opencode/agents" "$PRODUCT/.opencode/job-descriptions"
  mkdir -p "$PRODUCT/.opencode"
  cp -a "$GITHUB_WORKSPACE/.opencode/agents" "$PRODUCT/.opencode/agents"
  cp -a "$GITHUB_WORKSPACE/.opencode/job-descriptions" "$PRODUCT/.opencode/job-descriptions"
  cp "$GITHUB_WORKSPACE/AGENTS.md" "$PRODUCT/AGENTS.md"
}
restore_control(){
  git -C "$PRODUCT" checkout HEAD -- .opencode/agents .opencode/job-descriptions AGENTS.md >/dev/null 2>&1 || true
  git -C "$PRODUCT" clean -fd -- .opencode/agents .opencode/job-descriptions AGENTS.md >/dev/null 2>&1 || true
}
reset_agent_attempt(){
  git -C "$PRODUCT" reset --hard HEAD >/dev/null
  git -C "$PRODUCT" clean -fd >/dev/null
}
is_builder_agent(){
  case "$1" in wix-integration-builder|rules-engine-builder|dashboard-builder|billing-builder) return 0;; *) return 1;; esac
}

agent(){
  local name="$1" prompt="$2" chain model logf rc slug
  local -a models
  if is_builder_agent "$name"; then chain="$OX_BUILDER_MODELS"; else chain="$OX_REVIEW_MODELS"; fi
  read -r -a models <<< "$chain"
  (( ${#models[@]} > 0 )) || return 75
  for model in "${models[@]}"; do
    slug="${model//\//_}"
    logf="$ROOT/${name}-${slug}.log"
    overlay_control
    log "agent=$name model=$model"
    set +e
    (cd "$PRODUCT" && opencode run --model "$model" --agent "$name" "$prompt") > >(tee "$logf") 2>&1
    rc=$?
    set -e
    restore_control
    if (( rc == 0 )); then
      printf '%s\n' "$model" > "$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_${name}_model.txt"
      return 0
    fi
    if provider_failure "$logf"; then
      log "model=$model unavailable for agent=$name; trying next configured model"
      reset_agent_attempt
      continue
    fi
    return "$rc"
  done
  return 75
}

checks(){ (cd "$PRODUCT" && npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm run build); }
evidence(){ cp "$PRODUCT/$2" "$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_$1"; }
readonly_ok(){
  local allowed="$1" p
  while IFS= read -r p; do [[ -z "$p" || "$p" == "$allowed" ]] || { echo "forbidden auditor mutation: $p"; return 1; }; done < <({ git -C "$PRODUCT" diff --name-only; git -C "$PRODUCT" ls-files --others --exclude-standard; } | sort -u)
}
builder_name(){ case "$1" in integration) echo wix-integration-builder;; rules) echo rules-engine-builder;; dashboard) echo dashboard-builder;; billing) echo billing-builder;; *) die "unknown lane $1";; esac; }
auditor_name(){ case "$1" in integration) echo integration-auditor;; rules) echo rules-auditor;; dashboard) echo dashboard-auditor;; billing) echo billing-auditor;; *) die "unknown lane $1";; esac; }

allowed(){
  case "$1:$2" in
    integration:package.json|integration:package-lock.json|integration:tsconfig.json|integration:astro.config.mjs|integration:extensions.ts|integration:wix.config.json|integration:wix.config.example.json|integration:.gitignore|integration:vite.config.*|integration:vitest.config.*|integration:eslint.config.*|integration:src/env.d.ts|integration:src/platform/*|integration:src/platform/**|integration:src/extensions/backend/*|integration:src/extensions/backend/**|integration:tests/platform/*|integration:tests/platform/**) return 0;;
    rules:src/domain/*|rules:src/domain/**|rules:tests/domain/*|rules:tests/domain/**) return 0;;
    dashboard:src/extensions/dashboard/*|dashboard:src/extensions/dashboard/**|dashboard:src/ui/*|dashboard:src/ui/**|dashboard:tests/ui/*|dashboard:tests/ui/**) return 0;;
    billing:src/billing/*|billing:src/billing/**|billing:tests/billing/*|billing:tests/billing/**) return 0;;
    *) return 1;;
  esac
}
builder_scope(){
  local lane="$1" p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    case "$p" in .env|.env.*|*/.env|*/.env.*|*.key|*.pem|*.p8|*.p12|*credentials*|.wix/*) echo "credential-like path forbidden: $p"; return 1;; esac
    allowed "$lane" "$p" || { echo "out-of-lane path: $p"; return 1; }
  done < <({ git -C "$PRODUCT" diff --name-only; git -C "$PRODUCT" ls-files --others --exclude-standard; } | sort -u)
}
push_ref(){ git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin "$1:$2" >/dev/null; }
del_ref(){ [[ -z "${1:-}" || "$1" == null ]] && return 0; git -C "$PRODUCT" -c "http.extraheader=AUTHORIZATION: basic $(auth)" push origin ":$1" >/dev/null 2>&1 || true; }

commit_candidate(){
  local base="$1" lane="$2" candidate tag old_tag actor="wix-$lane-builder"
  old_tag="$(sget '.candidate.tag // ""')"
  if [[ "$lane" == integration && "$(sget '.repair_feedback // ""')" == OFFICIAL_WIX_SCAFFOLD_REBASE_REQUIRED* ]]; then actor="wix-official-scaffold"; fi
  git -C "$PRODUCT" config user.name "$actor"
  git -C "$PRODUCT" config user.email "$actor@users.noreply.github.com"
  git -C "$PRODUCT" add -A
  if git -C "$PRODUCT" diff --cached --quiet; then candidate="$base"; else git -C "$PRODUCT" commit -m "candidate($lane): generation $(sget '.generation')" >/dev/null; candidate="$(git -C "$PRODUCT" rev-parse HEAD)"; fi
  tag="refs/tags/factory-candidate/$lane/$(sget '.generation')"
  push_ref "$candidate" "$tag"
  if [[ -n "$old_tag" && "$old_tag" != null && "$old_tag" != "$tag" ]]; then del_ref "$old_tag"; fi
  sedit --arg s "$candidate" --arg t "$tag" '.candidate={sha:$s,tag:$t}|.repair_feedback=null'
  transition AUDIT candidate_created
}

phase_plan(){
  local ref report rc lane task
  ref="$(sget '.candidate.sha // .accepted_base')"; prepare "$ref"; report="reports/factory_director.json"; mkdir -p "$PRODUCT/reports"
  agent wix-build-director "Plan one next product lane from exact SHA $ref and this unresolved context: $(sget '.repair_feedback // "none"'). Planner only: never audit, build, mutate state, create refs, or say READY. Choose integration, rules, dashboard, or billing. Write only $report as strict JSON {lane,task,reason}; task must advance the product, not governance." || rc=$?
  rc=${rc:-0}; (( rc==0 )) && [[ -f "$PRODUCT/$report" ]] || { opfail PLAN "$([[ $rc == 75 ]] && echo provider_transient || echo director_failed)"; return; }
  readonly_ok "$report" || { opfail PLAN director_scope_violation; return; }
  jq -e '.lane and .task and .reason and (.lane=="integration" or .lane=="rules" or .lane=="dashboard" or .lane=="billing")' "$PRODUCT/$report" >/dev/null || { opfail PLAN invalid_director_json; return; }
  evidence director.json "$report"; lane="$(jq -r .lane "$PRODUCT/$report")"; task="$(jq -r .task "$PRODUCT/$report")"
  sedit --arg l "$lane" --arg t "$task" '.lane=$l|.repair_feedback=$t'; transition BUILD director_selected_lane
}

phase_build(){
  local base lane who rc feedback
  base="$(sget '.candidate.sha // .accepted_base')"; lane="$(sget '.lane')"; who="$(builder_name "$lane")"; feedback="$(sget '.repair_feedback // ""')"; prepare "$base"

  if [[ "$lane" == integration && "$feedback" == OFFICIAL_WIX_SCAFFOLD_REBASE_REQUIRED* ]]; then
    [[ -n "${WIX_API_KEY:-}" ]] || { transition BLOCKED_EXTERNAL wix_secret_unavailable; return; }
    log "integration bootstrap: regenerating authenticated official Wix scaffold for exact app $EXPECTED_WIX_APP_ID"
    set +e
    bash "$GITHUB_WORKSPACE/.github/scripts/wix-official-scaffold.sh" "$PRODUCT" "$ROOT/official-scaffold"
    rc=$?
    set -e
    if (( rc == 42 || rc == 43 || rc == 44 )); then
      transition BLOCKED_EXTERNAL official_wix_scaffold_external_failure
      return
    elif (( rc != 0 )); then
      opfail BUILD official_wix_scaffold_failed
      return
    fi
  else
    agent "$who" "Build only lane $lane from base SHA $base. Current task/repair feedback: $feedback. Preserve all already-audited work outside your lane and produce only the requested lane repair/progress toward a finished Wix app. Modify only your lane product files. Never edit orchestration, factory state, reports, prompts, agent definitions, refs or secrets. For Wix-owned binding/scaffold files, never guess identifiers or dependency versions: only preserve or consume official generated values. Do not audit yourself." || rc=$?
    rc=${rc:-0}; (( rc==0 )) || { opfail BUILD "$([[ $rc == 75 ]] && echo provider_transient || echo builder_failed)"; return; }
  fi

  builder_scope "$lane" || { opfail BUILD builder_scope_violation; return; }
  if ! checks; then
    if [[ "$lane" == integration ]]; then
      sedit '.repair_feedback="OFFICIAL_WIX_SCAFFOLD_REBASE_REQUIRED: merged scaffold or deterministic product checks failed; regenerate from the exact existing Wix app and preserve generated dependency versions."'
    else
      sedit '.repair_feedback="Deterministic checks failed; repair the same lane."'
    fi
    transition BUILD deterministic_checks_failed
    return
  fi
  commit_candidate "$base" "$lane"
}

phase_audit(){
  local lane sha tag who report rc verdict
  lane="$(sget '.lane')"; sha="$(sget '.candidate.sha')"; tag="$(sget '.candidate.tag')"; who="$(auditor_name "$lane")"; prepare "$sha"; report="reports/factory_lane_audit.md"; mkdir -p "$PRODUCT/reports"
  agent "$who" "Independently audit exact $lane candidate SHA $sha against accepted base $(sget '.accepted_base'). You are not its builder. For integration, verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses. Reproduce evidence and tests yourself. Never fix. Write only $report ending exactly VERDICT: ACCEPT or VERDICT: FIX; FIX must contain reproducible findings." || rc=$?
  rc=${rc:-0}; (( rc==0 )) && [[ -f "$PRODUCT/$report" ]] || { opfail AUDIT "$([[ $rc == 75 ]] && echo provider_transient || echo lane_auditor_failed)"; return; }
  readonly_ok "$report" || { opfail AUDIT lane_auditor_scope_violation; return; }; evidence "${lane}_audit.md" "$report"; verdict="$(parse_verdict "$PRODUCT/$report")"
  if [[ "$verdict" == ACCEPT ]]; then transition INTEGRATED_AUDIT lane_audit_accept
  elif [[ "$verdict" == FIX ]]; then
    sedit --arg f "$(sed '$d' "$PRODUCT/$report" | tail -c 12000)" '.repair_feedback=$f'; transition BUILD lane_audit_fix
  else opfail AUDIT invalid_lane_audit_verdict; fi
}

phase_integrated(){
  local sha tag report rc verdict
  sha="$(sget '.candidate.sha // .accepted_base')"; tag="$(sget '.candidate.tag // ""')"; prepare "$sha"
  checks || { sedit '.repair_feedback="Fresh integrated deterministic gate failed."'; transition PLAN integrated_checks_failed; return; }
  report="reports/factory_integrated_audit.md"; mkdir -p "$PRODUCT/reports"
  agent integrated-auditor "Fresh independent cross-system audit of exact SHA $sha. You are distinct from all builders and lane auditors. Verify integration/rules/dashboard/billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior and the real Wix scaffold assumptions. Never fix. Write only $report ending exactly VERDICT: ACCEPT or VERDICT: FIX." || rc=$?
  rc=${rc:-0}; (( rc==0 )) && [[ -f "$PRODUCT/$report" ]] || { opfail INTEGRATED_AUDIT "$([[ $rc == 75 ]] && echo provider_transient || echo integrated_auditor_failed)"; return; }
  readonly_ok "$report" || { opfail INTEGRATED_AUDIT integrated_auditor_scope_violation; return; }; evidence integrated_audit.md "$report"; verdict="$(parse_verdict "$PRODUCT/$report")"
  if [[ "$verdict" == ACCEPT ]]; then transition WIX_QA integrated_audit_accept
  elif [[ "$verdict" == FIX ]]; then sedit --arg f "$(sed '$d' "$PRODUCT/$report" | tail -c 12000)" '.repair_feedback=$f'; transition PLAN integrated_audit_fix
  else opfail INTEGRATED_AUDIT invalid_integrated_verdict; fi
}

phase_wix(){
  local sha tag report rc verdict
  sha="$(sget '.candidate.sha // .accepted_base')"; tag="$(sget '.candidate.tag // ""')"; prepare "$sha"
  [[ -f "$PRODUCT/wix.config.json" && "$(jq -r '.appId // empty' "$PRODUCT/wix.config.json")" == "$EXPECTED_WIX_APP_ID" ]] || { sedit '.lane="integration"|.repair_feedback="OFFICIAL_WIX_SCAFFOLD_REBASE_REQUIRED: real Wix binding missing or wrong; regenerate the exact existing app scaffold."'; transition BUILD wix_binding_invalid; return; }
  [[ -n "${WIX_SITE_ID:-}" && -n "${WIX_CLIENT_ID:-}" ]] || { transition BLOCKED_EXTERNAL wix_preflight_missing; return; }
  set +e; (cd "$PRODUCT" && npm ci --ignore-scripts --no-audit --no-fund) >"$ROOT/wix-npm-ci.log" 2>&1; rc=$?; set -e
  (( rc==0 )) || { opfail WIX_QA wix_dependency_install_failed; return; }
  set +e; (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" build) >"$ROOT/wix-build.log" 2>&1; rc=$?; set -e
  if (( rc!=0 )); then
    sed -E 's/(token|secret|password|api[_ -]?key)[=: ][^ ]+/\1=[REDACTED]/Ig' "$ROOT/wix-build.log" | tail -n120 > "$GITHUB_WORKSPACE/.factory/evidence/run_${GITHUB_RUN_ID}_wix_build_failure.txt"
    sedit '.lane="integration"|.repair_feedback="OFFICIAL_WIX_SCAFFOLD_REBASE_REQUIRED: real Wix CLI build failed on the deliverable; regenerate official scaffold and reconcile product wiring without hand-editing Wix identifiers."'; transition BUILD wix_build_failed; return
  fi
  set +e; (cd "$PRODUCT" && npx -y "@wix/cli@${WIX_CLI_VERSION}" dev-site list) >"$ROOT/wix-dev.log" 2>&1; rc=$?; set -e; (( rc==0 )) || { transition BLOCKED_EXTERNAL wix_dev_site_unavailable; return; }
  report="reports/factory_wix_live_audit.md"; mkdir -p "$PRODUCT/reports"
  agent wix-live-auditor "Empirically audit exact SHA $sha using Wix MCP after privileged CLI auth/build/dev-site resolution succeeded. Never inspect credentials/auth files, publish, release, delete, manage billing/domains/team/org, or touch production. Prefer reads; rollback any reversible QA mutation. Verify the real scaffold, actual app binding, Bookings contracts, generated/registered extension reality, dashboard compatibility, permissions, entitlement inputs and webhook assumptions where testable. Never fix. Write only $report ending exactly VERDICT: ACCEPT, VERDICT: FIX, or VERDICT: BLOCKED_EXTERNAL." || rc=$?
  rc=${rc:-0}; (( rc==0 )) && [[ -f "$PRODUCT/$report" ]] || { opfail WIX_QA "$([[ $rc == 75 ]] && echo provider_transient || echo wix_live_auditor_failed)"; return; }
  readonly_ok "$report" || { opfail WIX_QA wix_live_scope_violation; return; }; evidence wix_live_audit.md "$report"; verdict="$(parse_verdict "$PRODUCT/$report")"
  case "$verdict" in
    ACCEPT) transition RELEASE_AUDIT wix_live_accept;;
    BLOCKED_EXTERNAL) transition BLOCKED_EXTERNAL wix_live_blocked;;
    FIX) sedit --arg f "$(sed '$d' "$PRODUCT/$report" | tail -c 12000)" '.lane="integration"|.repair_feedback=$f'; transition BUILD wix_live_fix;;
    *) opfail WIX_QA invalid_wix_live_verdict;;
  esac
}

phase_release(){
  local sha tag accepted report rc verdict proof remote
  sha="$(sget '.candidate.sha // .accepted_base')"; tag="$(sget '.candidate.tag // ""')"; accepted="$(sget '.accepted_base')"; prepare "$sha"; report="reports/factory_release_audit.md"; mkdir -p "$PRODUCT/reports"
  proof="$(find "$GITHUB_WORKSPACE/.factory/evidence" -maxdepth 1 -type f -print0 | sort -z | xargs -0 cat 2>/dev/null | tail -c 40000)"
  agent release-readiness-auditor "FINAL independent release audit of exact SHA $sha. Sole READY authority. Current immutable factory evidence follows:\n$proof\nRequire fresh deterministic checks, fresh integrated ACCEPT, fresh Wix empirical ACCEPT, correct app binding $EXPECTED_WIX_APP_ID, real Wix-generated scaffold provenance, and no unresolved repair. If this run began from the already accepted benchmarked product without a new candidate diff, a fresh integrated audit substitutes for a new lane audit; otherwise require the independent lane audit too. Never fix or plan. Write only $report ending exactly VERDICT: READY or VERDICT: NOT_READY." || rc=$?
  rc=${rc:-0}; (( rc==0 )) && [[ -f "$PRODUCT/$report" ]] || { opfail RELEASE_AUDIT "$([[ $rc == 75 ]] && echo provider_transient || echo release_auditor_failed)"; return; }
  readonly_ok "$report" || { opfail RELEASE_AUDIT release_scope_violation; return; }; evidence release_audit.md "$report"; verdict="$(parse_verdict "$PRODUCT/$report")"
  if [[ "$verdict" == READY ]]; then
    checks || { opfail RELEASE_AUDIT final_deterministic_gate_failed; return; }; fetch_product; remote="$(git -C "$GITHUB_WORKSPACE" rev-parse "$PRODUCT_REF")"; [[ "$remote" == "$accepted" ]] || { opfail RELEASE_AUDIT accepted_base_moved; return; }
    [[ "$sha" == "$accepted" ]] || push_ref "$sha" "refs/heads/$PRODUCT_BRANCH"; del_ref "$tag"; sedit --arg s "$sha" '.accepted_base=$s|.candidate=null|.repair_feedback=null'; transition READY final_release_ready
  elif [[ "$verdict" == NOT_READY ]]; then
    sedit --arg f "$(sed '$d' "$PRODUCT/$report" | tail -c 12000)" '.repair_feedback=$f'; transition PLAN final_release_not_ready
  else opfail RELEASE_AUDIT invalid_release_verdict; fi
}

main(){
  [[ -f "$STATE" ]] || die "missing canonical state"
  printf '%s  MAIN_PROMPT.md\n' "$MAIN_PROMPT_SHA256" | (cd "$GITHUB_WORKSPACE" && sha256sum --check --strict)
  jq -e '.architecture=="lane-machine/1" and .generation>=1 and .accepted_base and .phase' "$STATE" >/dev/null
  [[ "$(remote_main)" == "$GITHUB_SHA" ]] || die "stale run; main moved before execution"
  fetch_product
  [[ "$(git -C "$GITHUB_WORKSPACE" rev-parse "$PRODUCT_REF")" == "$(sget '.accepted_base')" ]] || die "accepted product drift"
  local before="$GITHUB_SHA" phase="$(sget '.phase')"
  sedit --argjson run "$GITHUB_RUN_ID" --arg p "$phase" '.lease={run_id:$run,phase:$p}'
  log "generation=$(sget '.generation') phase=$phase accepted=$(sget '.accepted_base')"
  case "$phase" in
    PLAN) phase_plan;; BUILD) phase_build;; AUDIT) phase_audit;; INTEGRATED_AUDIT) phase_integrated;; WIX_QA|BLOCKED_EXTERNAL) phase_wix;; RELEASE_AUDIT) phase_release;; READY) sedit '.lease=null';; *) die "unknown phase $phase";;
  esac
  persist "$before"
}
main "$@"
