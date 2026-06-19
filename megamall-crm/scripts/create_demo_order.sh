#!/usr/bin/env bash
# create_demo_order.sh — Creates a single new order for Dispatcher Board testing.
#
# Usage:
#   BASE_URL=http://localhost:8080 bash scripts/create_demo_order.sh
#
# Prerequisites:
#   1. Server running with DB_DSN pointing to a migrated database.
#   2. Seed data present: go run ./cmd/seed
#   3. jq installed.
#
# What it does:
#   1. Login as seller
#   2. Get seed product (TEST-001) and main warehouse
#   3. Create a customer with a unique phone number
#   4. Create a seller_order
#   5. Print order_id and order_number — then stop.
#
# The order is left in status=new for the dispatcher to action in the frontend.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
API="${BASE_URL}/api/v1"

# ── Dependency check ──────────────────────────────────────────────────────────
command -v jq   >/dev/null 2>&1 || { echo "ERROR: jq is required. Install: brew install jq"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required."; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────
ok()   { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✗ FAILED: %s\n" "$1"; exit 1; }

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

echo ""
echo "══════════════════════════════════════════════════"
echo "  create_demo_order — Dispatcher Board test data"
echo "══════════════════════════════════════════════════"

# ── Step 1: Login as seller ───────────────────────────────────────────────────
echo ""
echo "[1] Login as seller (+992900000004)…"

LOGIN=$(call POST /auth/login "" '{"phone":"+992900000004","password":"password123"}')
SELLER_TOKEN=$(echo "$LOGIN" | jq -r '.data.access_token // empty')
[ -n "$SELLER_TOKEN" ] || fail "Seller login failed: $(echo "$LOGIN" | jq -r '.error.message // .error // "unknown"')"
ok "Logged in as seller"

# ── Step 2: Get seed product (TEST-001) ───────────────────────────────────────
echo ""
echo "[2] Looking up product TEST-001…"

PRODUCTS=$(call GET "/products?search=TEST-001&limit=5" "$SELLER_TOKEN")
PRODUCT_ID=$(echo "$PRODUCTS" | jq -r '.data[0].id // empty')
[ -n "$PRODUCT_ID" ] || fail "Product TEST-001 not found. Run: go run ./cmd/seed"
PRODUCT_NAME=$(echo "$PRODUCTS" | jq -r '.data[0].name // "TEST-001"')
PRODUCT_PRICE=$(echo "$PRODUCTS" | jq -r '.data[0].sale_price // 100')
ok "Product: $PRODUCT_NAME (id=$PRODUCT_ID, price=$PRODUCT_PRICE)"

# ── Step 3: Get main warehouse ────────────────────────────────────────────────
echo ""
echo "[3] Looking up main warehouse…"

WAREHOUSES=$(call GET "/warehouses?limit=5" "$SELLER_TOKEN")
WAREHOUSE_ID=$(echo "$WAREHOUSES" | jq -r '.data[0].id // empty')
[ -n "$WAREHOUSE_ID" ] || fail "No warehouse found. Run: go run ./cmd/seed"
WAREHOUSE_NAME=$(echo "$WAREHOUSES" | jq -r '.data[0].name // "Main Warehouse"')
ok "Warehouse: $WAREHOUSE_NAME (id=$WAREHOUSE_ID)"

# ── Step 4: Create customer with unique phone ─────────────────────────────────
echo ""
echo "[4] Creating test customer…"

# Use last 6 digits of current timestamp to get a unique phone
SUFFIX=$(date +%S%N 2>/dev/null | tail -c 6 || date +%s | tail -c 6)
PHONE="+99290${SUFFIX}"
FULL_NAME="Тест Клиент ${SUFFIX}"

CUST=$(call POST /customers "$SELLER_TOKEN" \
  "{\"full_name\":\"${FULL_NAME}\",\"phone\":\"${PHONE}\",\"source\":\"phone\"}")
CUSTOMER_ID=$(echo "$CUST" | jq -r '.data.id // empty')
[ -n "$CUSTOMER_ID" ] || fail "Customer creation failed: $(echo "$CUST" | jq -r '.error.message // .error // "unknown"')"
ok "Customer: $FULL_NAME / $PHONE (id=$CUSTOMER_ID)"

# ── Step 5: Create seller_order ───────────────────────────────────────────────
echo ""
echo "[5] Creating seller_order…"

ORDER=$(call POST /orders "$SELLER_TOKEN" \
  "{
    \"customer_id\":  \"${CUSTOMER_ID}\",
    \"warehouse_id\": \"${WAREHOUSE_ID}\",
    \"order_type\":   \"seller_order\",
    \"items\": [
      {
        \"product_id\": \"${PRODUCT_ID}\",
        \"quantity\":   1,
        \"unit_price\": ${PRODUCT_PRICE}
      }
    ]
  }")

ORDER_ID=$(echo "$ORDER" | jq -r '.data.id // empty')
[ -n "$ORDER_ID" ] || fail "Order creation failed: $(echo "$ORDER" | jq -r '.error.message // .error // "unknown"')"

ORDER_NUMBER=$(echo "$ORDER"  | jq -r '.data.order_number // "—"')
STATUS=$(echo "$ORDER"        | jq -r '.data.status       // "—"')
TOTAL=$(echo "$ORDER"         | jq -r '.data.total_amount // "—"')
FEE=$(echo "$ORDER"           | jq -r '.data.delivery_fee // "—"')
NET=$(echo "$ORDER"           | jq -r '.data.net_revenue  // "—"')

ok "Order created"

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅  Order ready for Dispatcher Board"
echo "══════════════════════════════════════════════════"
echo ""
echo "  order_id     : $ORDER_ID"
echo "  order_number : $ORDER_NUMBER"
echo "  status       : $STATUS"
echo "  total_amount : $TOTAL"
echo "  delivery_fee : $FEE"
echo "  net_revenue  : $NET"
echo "  customer     : $FULL_NAME ($PHONE)"
echo ""
echo "  Open the Dispatcher Board and refresh to see this order."
echo ""
