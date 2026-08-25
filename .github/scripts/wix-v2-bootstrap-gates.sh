#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f docs/PRODUCT_GATES.json ]]; then
cat > docs/PRODUCT_GATES.json <<'EOF'
{"schema_version":1,"policy":"PROVEN requires concrete persisted evidence; human/Wix prerequisites may be BLOCKED_EXTERNAL.","gates":{"rules_domain":{"required":true,"status":"OPEN","evidence":[],"owner":"rules"},"dashboard_rule_editor":{"required":true,"status":"OPEN","evidence":[],"owner":"dashboard"},"booking_time_enforcement":{"required":true,"status":"OPEN","evidence":[],"owner":"integration"},"schedule_mutation_rollback_recovery":{"required":true,"status":"OPEN","evidence":[],"owner":"integration"},"billing_entitlement_reconciliation":{"required":true,"status":"OPEN","evidence":[],"owner":"billing"},"cross_lane_contract_parity":{"required":true,"status":"OPEN","evidence":[],"owner":"director"},"accessibility":{"required":true,"status":"OPEN","evidence":[],"owner":"dashboard"},"credential_free_build_and_tests":{"required":true,"status":"OPEN","evidence":[],"owner":"director"},"real_wix_scaffold_registration":{"required":true,"status":"OPEN","evidence":[],"owner":"integration"},"empirical_wix_validation":{"required":true,"status":"OPEN","evidence":[],"owner":"integration"},"real_wix_build_release":{"required":true,"status":"OPEN","evidence":[],"owner":"integration"}}}
EOF
fi
[[ -f docs/LOOP_HEALTH.json ]] || printf '%s\n' '{"schema_version":1,"last_cycle":0,"last_task_fingerprint":"","stagnant_cycles":0,"same_task_cycles":0,"last_accepted_product_changes":0,"stalled":false,"reason":null}' > docs/LOOP_HEALTH.json
