#!/usr/bin/env bash
# e2e_flow.sh — Full end-to-end business flow validation for megamall-crm.
#
# Usage:
#   BASE_URL=http://localhost:8080 bash scripts/e2e_flow.sh
#
# Prerequisites:
#   1. Server running with DB_DSN pointing to a migrated database.
#   2. Seed data present: go run ./cmd/seed
#   3. jq and bc installed.
#
# What is validated:
#   Owner → Login
#   Seller → Login → Create Customer → Create Order
#   Dispatcher → Confirm → Assign Courier
#   Courier → Start Delivery → Mark Delivered
#   Finance → Fetch Snapshot → Fetch Events → Verify Amounts
#   Cash → Summary → Submit Handover → Dispatcher Confirms

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
API="${BASE_URL}/api/v1"

# ── Guard: refuse anything production-shaped ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dbsafety.sh
source "$SCRIPT_DIR/lib/dbsafety.sh"
refuse_if_production_env
refuse_if_production_value "BASE_URL" "$BASE_URL"
refuse_if_non_local_host "BASE_URL" "$BASE_URL"

# Floating-point tolerance for amount comparisons (0.01 = 1 cent).
TOLERANCE="0.01"

# ── Dependency check ──────────────────────────────────────────────────────────
command -v jq  >/dev/null 2>&1 || { echo "ERROR: jq is required. Install with: brew install jq"; exit 1; }
command -v bc  >/dev/null 2>&1 || { echo "ERROR: bc is required. Install with: brew install bc"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required."; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────
STEP=0

step() {
  STEP=$((STEP + 1))
  printf "\n[STEP %02d] %s\n" "$STEP" "$1"
}

ok() {
  printf "  ✓ %s\n" "$1"
}

fail() {
  printf "  ✗ FAILED: %s\n" "$1"
  exit 1
}

# call <method> <path> [token] [body]
call() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"

  local args=(-s -X "$method" "${API}${path}" -H "Content-Type: application/json")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body"  ] && args+=(-d "$body")

  curl "${args[@]}"
}

# assert_success <response_json> <context>
assert_success() {
  local resp="$1"
  local ctx="$2"
  local success
  success=$(echo "$resp" | jq -r '.success')
  if [ "$success" != "true" ]; then
    local msg
    msg=$(echo "$resp" | jq -r '.error.message // "unknown error"')
    fail "[$ctx] success=false — $msg"
  fi
}

# abs_diff <a> <b> — returns absolute difference as float string
abs_diff() {
  echo "d=$1-($2); if(d<0) d=-d; d" | bc -l
}

# within_tolerance <a> <b> — exits 0 (success) if |a-b| <= TOLERANCE
within_tolerance() {
  local diff result
  diff=$(abs_diff "$1" "$2")
  # bc prints "1" or "0"; strip any trailing newline/whitespace
  result=$(echo "$diff <= $TOLERANCE" | bc -l | tr -d '[:space:]')
  [ "$result" = "1" ]
}

login() {
  local phone="$1"
  local resp
  resp=$(call POST /auth/login "" "{\"phone\":\"$phone\",\"password\":\"password123\"}")
  assert_success "$resp" "login $phone"
  echo "$resp" | jq -r '.data.access_token'
}

# ── Pre-flight: health check ──────────────────────────────────────────────────
step "Health check"
HEALTH=$(call GET /health)
assert_success "$HEALTH" "health"
ok "Server is up: $(echo "$HEALTH" | jq -r '.data.status')"

step "Readiness check"
READY=$(call GET /ready)
READY_STATUS=$(echo "$READY" | jq -r '.data.ready')
if [ "$READY_STATUS" != "true" ]; then
  echo "  ! Readiness checks:"
  echo "$READY" | jq '.data.checks'
  fail "Server is not ready — run: go run ./cmd/seed"
fi
ok "All readiness checks passed"

# ── Authentication ────────────────────────────────────────────────────────────
step "Login as owner"
OWNER_TOKEN=$(login "+992900000001")
ok "owner token acquired"

step "Login as seller"
SELLER_TOKEN=$(login "+992900000004")
ok "seller token acquired"

step "Login as dispatcher"
DISPATCHER_TOKEN=$(login "+992900000005")
ok "dispatcher token acquired"

step "Login as courier"
COURIER_TOKEN=$(login "+992900000007")
ok "courier token acquired"

# ── Customer ──────────────────────────────────────────────────────────────────
step "Create customer (as seller)"
CUST_RESP=$(call POST /customers "$SELLER_TOKEN" \
  '{"full_name":"E2E Test Customer","phone":"+992901999999","source":"phone"}')
assert_success "$CUST_RESP" "create customer"
CUSTOMER_ID=$(echo "$CUST_RESP" | jq -r '.data.id')
ok "customer_id=$CUSTOMER_ID"

# ── Resolve seed IDs needed for order creation ────────────────────────────────
step "Resolve seed product and warehouse IDs"
PRODUCTS_RESP=$(call GET "/products?search=TEST-001&limit=1" "$OWNER_TOKEN")
assert_success "$PRODUCTS_RESP" "list products"
PRODUCT_ID=$(echo "$PRODUCTS_RESP" | jq -r '.data[0].id')
[ "$PRODUCT_ID" = "null" ] && fail "TEST-001 product not found — run: go run ./cmd/seed"
ok "product_id=$PRODUCT_ID"

WAREHOUSES_RESP=$(call GET /warehouses "$OWNER_TOKEN")
assert_success "$WAREHOUSES_RESP" "list warehouses"
WAREHOUSE_ID=$(echo "$WAREHOUSES_RESP" | jq -r '.data[0].id')
[ "$WAREHOUSE_ID" = "null" ] && fail "No warehouse found — run: go run ./cmd/seed"
ok "warehouse_id=$WAREHOUSE_ID"

# Capture pre-order inventory quantity for later deduction check.
PRE_INV_RESP=$(call GET "/inventory?warehouse_id=$WAREHOUSE_ID&product_id=$PRODUCT_ID" "$OWNER_TOKEN")
PRE_ORDER_QTY=$(echo "$PRE_INV_RESP" | jq -r '.data[0].quantity // .data[0].available_quantity // "0"')

# ── Order creation ────────────────────────────────────────────────────────────
step "Create order as seller (seller_order, qty=1, unit_price=100)"
ORDER_BODY=$(cat <<EOF
{
  "customer_id": "$CUSTOMER_ID",
  "warehouse_id": "$WAREHOUSE_ID",
  "order_type": "seller_order",
  "items": [{"product_id":"$PRODUCT_ID","quantity":1,"unit_price":100}]
}
EOF
)
ORDER_RESP=$(call POST /orders "$SELLER_TOKEN" "$ORDER_BODY")
assert_success "$ORDER_RESP" "create order"
ORDER_ID=$(echo "$ORDER_RESP" | jq -r '.data.id')
ORDER_NUMBER=$(echo "$ORDER_RESP" | jq -r '.data.order_number')
ok "order_id=$ORDER_ID  order_number=$ORDER_NUMBER"

# Capture financial fields for later validation.
TOTAL_AMOUNT=$(echo "$ORDER_RESP" | jq -r '.data.total_amount')
DELIVERY_FEE=$(echo "$ORDER_RESP" | jq -r '.data.delivery_fee')
NET_REVENUE=$(echo "$ORDER_RESP" | jq -r '.data.net_revenue')

ok "total_amount=$TOTAL_AMOUNT  delivery_fee=$DELIVERY_FEE  net_revenue=$NET_REVENUE"

# ── Confirm order ─────────────────────────────────────────────────────────────
step "Dispatcher confirms order (new → confirmed)"
CONFIRM_RESP=$(call POST "/dispatch/orders/$ORDER_ID/confirm" "$DISPATCHER_TOKEN" '{}')
assert_success "$CONFIRM_RESP" "confirm order"
ok "status=$(echo "$CONFIRM_RESP" | jq -r '.data.status')"

# ── Assign courier ────────────────────────────────────────────────────────────
step "Dispatcher assigns courier (confirmed → assigned)"
# Resolve courier user ID from the seed phone.
USERS_RESP=$(call GET "/users?limit=50" "$OWNER_TOKEN")
COURIER_USER_ID=$(echo "$USERS_RESP" | jq -r '.data[] | select(.phone == "+992900000007") | .id')
[ -z "$COURIER_USER_ID" ] || [ "$COURIER_USER_ID" = "null" ] && fail "courier user not found"
ok "courier_user_id=$COURIER_USER_ID"

ASSIGN_RESP=$(call POST "/dispatch/orders/$ORDER_ID/assign" "$DISPATCHER_TOKEN" \
  "{\"courier_id\":\"$COURIER_USER_ID\"}")
assert_success "$ASSIGN_RESP" "assign courier"
ASSIGNMENT_ID=$(echo "$ASSIGN_RESP" | jq -r '.data.id')
ok "assignment_id=$ASSIGNMENT_ID  status=assigned"

# ── Courier: start delivery ───────────────────────────────────────────────────
step "Courier starts delivery (assigned → in_delivery)"
START_RESP=$(call POST "/courier/orders/$ORDER_ID/start" "$COURIER_TOKEN" '{}')
assert_success "$START_RESP" "start delivery"
ok "status=$(echo "$START_RESP" | jq -r '.data.status')"

# ── Courier: mark delivered ───────────────────────────────────────────────────
step "Courier marks order delivered (in_delivery → delivered)"
DELIVER_RESP=$(call POST "/courier/orders/$ORDER_ID/delivered" "$COURIER_TOKEN" '{}')
assert_success "$DELIVER_RESP" "mark delivered"
ok "status=$(echo "$DELIVER_RESP" | jq -r '.data.status')"

# ─────────────────────────────────────────────────────────────────────────────
# FINANCIAL VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

# net_revenue is only provisional (total_amount + delivery_fee) until delivery —
# it's frozen to its final value (== commission_base) once courier_payout is
# known, so re-fetch the order now that it's delivered.
step "Re-fetch order after delivery (net_revenue is frozen at this point)"
ORDER_AFTER_RESP=$(call GET "/orders/$ORDER_ID" "$OWNER_TOKEN")
assert_success "$ORDER_AFTER_RESP" "fetch order after delivery"
COURIER_PAYOUT=$(echo "$ORDER_AFTER_RESP" | jq -r '.data.courier_payout')
NET_REVENUE=$(echo "$ORDER_AFTER_RESP" | jq -r '.data.net_revenue')
ok "courier_payout=$COURIER_PAYOUT  net_revenue(frozen)=$NET_REVENUE"

# ── Validate net_revenue = total_amount + delivery_fee - courier_payout ──────
step "Validate net_revenue = total_amount + delivery_fee - courier_payout"
EXPECTED_NET=$(echo "$TOTAL_AMOUNT + $DELIVERY_FEE - $COURIER_PAYOUT" | bc -l | awk '{printf "%.5f", $1}')
ACTUAL_NET=$(printf "%.5f" "$NET_REVENUE")
if within_tolerance "$ACTUAL_NET" "$EXPECTED_NET"; then
  ok "net_revenue check passed: $ACTUAL_NET ≈ $EXPECTED_NET (total=$TOTAL_AMOUNT + fee=$DELIVERY_FEE - courier_payout=$COURIER_PAYOUT)"
else
  fail "net_revenue mismatch: got $ACTUAL_NET expected $EXPECTED_NET"
fi

# ── Fetch snapshot ────────────────────────────────────────────────────────────
step "Fetch order financial snapshot"
SNAP_RESP=$(call GET "/orders/$ORDER_ID/snapshot" "$OWNER_TOKEN")
assert_success "$SNAP_RESP" "fetch snapshot"
SNAP=$(echo "$SNAP_RESP" | jq '.data')

# Snapshot fields are PascalCase (Go struct without json tags).
SELLER_RATE=$(echo "$SNAP" | jq -r '.SellerRate')
MGR_TEAM_RATE=$(echo "$SNAP" | jq -r '.ManagerTeamRate')
TL_POOL_RATE=$(echo "$SNAP" | jq -r '.TeamLeadPoolRate')
COMPANY_RATE=$(echo "$SNAP" | jq -r '.CompanyRate')
TARIFF_FEE=$(echo "$SNAP" | jq -r '.TariffFee')

ok "seller_rate=$SELLER_RATE  manager_team_rate=$MGR_TEAM_RATE  team_lead_pool_rate=$TL_POOL_RATE  company_rate=$COMPANY_RATE"
ok "tariff_fee=$TARIFF_FEE"

# Verify snapshot tariff_fee matches order delivery_fee.
if within_tolerance "$TARIFF_FEE" "$DELIVERY_FEE"; then
  ok "snapshot tariff_fee matches order delivery_fee ✓"
else
  fail "tariff_fee mismatch: snapshot=$TARIFF_FEE order.delivery_fee=$DELIVERY_FEE"
fi

# ── Fetch financial events ────────────────────────────────────────────────────
step "Fetch financial events for order"
EVENTS_RESP=$(call GET "/hr/events?order_id=$ORDER_ID" "$OWNER_TOKEN")
assert_success "$EVENTS_RESP" "fetch events"
EVENTS=$(echo "$EVENTS_RESP" | jq '.data')
EVENT_COUNT=$(echo "$EVENTS" | jq 'length')
ok "financial events received: $EVENT_COUNT"
[ "$EVENT_COUNT" -lt 2 ] && fail "expected at least 2 financial events, got $EVENT_COUNT"

# ── Validate financial event amounts (revised business rules) ──────────────────
step "Validate financial event amounts against snapshot rates (seller_order)"
#
# Revised model:
#   company_revenue  = net_revenue × company_rate          (fixed %)
#   seller_commission = net_revenue × seller_rate          (fixed %)
#   manager_team     = net_revenue × manager_team_rate     (fixed %)
#   team_lead_pool   = net_revenue − company − seller − manager_team  (RESIDUAL)
#
# Invariant: company + seller + manager_team + team_lead_pool == net_revenue

# company_revenue_earned = net_revenue × company_rate
EXPECTED_CO=$(echo "$NET_REVENUE * $COMPANY_RATE" | bc -l | awk '{printf "%.5f", $1}')
ACTUAL_CO=$(echo "$EVENTS" | jq -r '[.[] | select(.event_type == "company_revenue_earned")] | .[0].amount // "0"')
if within_tolerance "$ACTUAL_CO" "$EXPECTED_CO"; then
  ok "company_revenue_earned: $ACTUAL_CO ≈ $EXPECTED_CO ✓"
else
  fail "company_revenue_earned mismatch: got $ACTUAL_CO expected $EXPECTED_CO"
fi

# seller_commission_earned = net_revenue × seller_rate
EXPECTED_SELLER=$(echo "$NET_REVENUE * $SELLER_RATE" | bc -l | awk '{printf "%.5f", $1}')
ACTUAL_SELLER=$(echo "$EVENTS" | jq -r '[.[] | select(.event_type == "seller_commission_earned")] | .[0].amount // "0"')
if within_tolerance "$ACTUAL_SELLER" "$EXPECTED_SELLER"; then
  ok "seller_commission_earned: $ACTUAL_SELLER ≈ $EXPECTED_SELLER ✓"
else
  fail "seller_commission_earned mismatch: got $ACTUAL_SELLER expected $EXPECTED_SELLER"
fi

# manager_team_commission_earned = net_revenue × manager_team_rate
EXPECTED_MGR=$(echo "$NET_REVENUE * $MGR_TEAM_RATE" | bc -l | awk '{printf "%.5f", $1}')
ACTUAL_MGR=$(echo "$EVENTS" | jq -r '[.[] | select(.event_type == "manager_team_commission_earned")] | .[0].amount // "0"')
# manager_team event may be absent if order.manager_id is nil — treat missing as 0
[ "$ACTUAL_MGR" = "null" ] && ACTUAL_MGR="0"
if within_tolerance "$ACTUAL_MGR" "$EXPECTED_MGR"; then
  ok "manager_team_commission_earned: $ACTUAL_MGR ≈ $EXPECTED_MGR ✓"
else
  fail "manager_team_commission_earned mismatch: got $ACTUAL_MGR expected $EXPECTED_MGR"
fi

# team_lead_pool_earned = net_revenue − company − seller − manager_team  (RESIDUAL)
EXPECTED_TL=$(echo "$NET_REVENUE - $EXPECTED_CO - $EXPECTED_SELLER - $EXPECTED_MGR" | bc -l | awk '{printf "%.5f", $1}')
ACTUAL_TL=$(echo "$EVENTS" | jq -r '[.[] | select(.event_type == "team_lead_pool_earned")] | .[0].amount // "0"')
[ "$ACTUAL_TL" = "null" ] && ACTUAL_TL="0"
if within_tolerance "$ACTUAL_TL" "$EXPECTED_TL"; then
  ok "team_lead_pool_earned: $ACTUAL_TL ≈ $EXPECTED_TL (residual) ✓"
else
  fail "team_lead_pool_earned mismatch: got $ACTUAL_TL expected $EXPECTED_TL (residual)"
fi

# Invariant: sum of all event amounts == net_revenue
step "Verify sum of all financial events equals net_revenue"
EVENT_SUM=$(echo "$EVENTS" | jq '[.[].amount] | add // 0')
if within_tolerance "$EVENT_SUM" "$NET_REVENUE"; then
  ok "sum of events ($EVENT_SUM) ≈ net_revenue ($NET_REVENUE) ✓"
else
  fail "sum of events ($EVENT_SUM) != net_revenue ($NET_REVENUE) — possible over/underpayment"
fi

# ── Inventory deduction ───────────────────────────────────────────────────────
step "Verify inventory was deducted after delivery"
INV_RESP=$(call GET "/inventory?warehouse_id=$WAREHOUSE_ID&product_id=$PRODUCT_ID" "$OWNER_TOKEN")
assert_success "$INV_RESP" "fetch inventory"
CURRENT_QTY=$(echo "$INV_RESP" | jq -r '.data[0].quantity // .data[0].available_quantity // "unknown"')
ok "current inventory quantity: $CURRENT_QTY (was $PRE_ORDER_QTY before order)"
# We ordered qty=1, so quantity should be pre_order_qty - 1.
EXPECTED_QTY=$(echo "$PRE_ORDER_QTY - 1" | bc)
QTY_OK=$([ "$CURRENT_QTY" = "$EXPECTED_QTY" ] && echo "1" || echo "0")
[ "$QTY_OK" -eq 1 ] && ok "inventory deduction confirmed: $PRE_ORDER_QTY → $CURRENT_QTY ✓" || fail "inventory not deducted: expected $EXPECTED_QTY, got $CURRENT_QTY"

# ── Cash collection ───────────────────────────────────────────────────────────
step "Courier cash summary"
SUMMARY_RESP=$(call GET /courier/cash/summary "$COURIER_TOKEN")
assert_success "$SUMMARY_RESP" "cash summary"
COLLECTED=$(echo "$SUMMARY_RESP" | jq -r '.data.total_collected')
TO_RETURN=$(echo "$SUMMARY_RESP" | jq -r '.data.total_to_return')
ok "total_collected=$COLLECTED  total_to_return=$TO_RETURN"

# The summary aggregates ALL of this courier's unsubmitted delivered orders
# (may include orders from previous test runs), so we only assert > 0.
COLLECTED_OK=$(echo "$COLLECTED > 0" | bc -l | tr -d '[:space:]')
[ "$COLLECTED_OK" = "1" ] && ok "cash collection is positive ✓" || fail "total_collected is not positive: $COLLECTED"

# ── Submit handover ───────────────────────────────────────────────────────────
step "Courier submits cash handover"
HANDOVER_RESP=$(call POST /courier/cash/handover "$COURIER_TOKEN" '{}')
assert_success "$HANDOVER_RESP" "submit handover"
HANDOVER_ID=$(echo "$HANDOVER_RESP" | jq -r '.data.id')
HANDOVER_STATUS=$(echo "$HANDOVER_RESP" | jq -r '.data.status')
ok "handover_id=$HANDOVER_ID  status=$HANDOVER_STATUS"
[ "$HANDOVER_STATUS" = "pending" ] || fail "expected handover status=pending, got $HANDOVER_STATUS"

# ── Dispatcher confirms handover ──────────────────────────────────────────────
step "Dispatcher confirms cash handover"
TOTAL_TO_RETURN=$(echo "$HANDOVER_RESP" | jq -r '.data.total_to_return')
ok "total_to_return=$TOTAL_TO_RETURN"

CONFIRM_HANDOVER_RESP=$(call POST "/dispatch/cash/handovers/$HANDOVER_ID/confirm" "$DISPATCHER_TOKEN" \
  "{\"actual_returned\":$TOTAL_TO_RETURN}")
assert_success "$CONFIRM_HANDOVER_RESP" "confirm handover"
FINAL_STATUS=$(echo "$CONFIRM_HANDOVER_RESP" | jq -r '.data.status')
ok "handover final status=$FINAL_STATUS"
[ "$FINAL_STATUS" = "confirmed" ] || fail "expected handover status=confirmed, got $FINAL_STATUS"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
printf "  ✅  ALL %02d STEPS PASSED\n" "$STEP"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Order #${ORDER_NUMBER}"
echo "  total_amount   = ${TOTAL_AMOUNT}"
echo "  delivery_fee   = ${DELIVERY_FEE}"
echo "  net_revenue    = ${NET_REVENUE}"
echo "  handover       = ${HANDOVER_ID} (${FINAL_STATUS})"
echo ""
