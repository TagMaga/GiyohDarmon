# megamall-crm API Reference — Phase 6

All responses use the standard envelope:

```json
{ "success": true,  "data": { ... }, "meta": null }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

Pagination meta (list endpoints):
```json
"meta": { "page": 1, "limit": 20, "total": 42, "total_pages": 3 }
```

Base URL: `http://localhost:8080/api/v1`

---

## Seed Users

All users seeded by `go run ./cmd/seed` with password `password123`.

| Role               | Phone          | Description                     |
|--------------------|----------------|---------------------------------|
| owner              | +992900000001  | System owner, full access       |
| sales_team_lead    | +992900000002  | Team lead of the demo team      |
| manager            | +992900000003  | Manager under the team lead     |
| seller             | +992900000004  | Seller who creates orders       |
| dispatcher         | +992900000005  | Confirms orders, assigns couriers |
| warehouse_manager  | +992900000006  | Manages inventory                |
| courier            | +992900000007  | Delivers orders, handles cash   |

Seed also creates: **Main Warehouse**, product **TEST-001** (sale price 100, purchase price 40), 100 units in stock, commission configs for all 5 types, and an active delivery tariff (fee = 5).

---

## Health & Readiness

### GET /health
No auth required. Always returns 200.

```bash
curl http://localhost:8080/api/v1/health
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "db": "ok",
    "migration_version": "34"
  }
}
```

### GET /ready
No auth required. Returns 200 if all checks pass, 503 otherwise.

```bash
curl http://localhost:8080/api/v1/ready
```

Response (ready):
```json
{
  "success": true,
  "data": {
    "ready": true,
    "checks": {
      "database":             "ok",
      "owner_user":           "ok",
      "default_warehouse":    "ok",
      "default_product":      "ok",
      "commission_configs":   "ok",
      "delivery_tariff":      "ok"
    }
  }
}
```

Response (not ready, HTTP 503):
```json
{
  "success": false,
  "data": {
    "ready": false,
    "checks": {
      "database":           "ok",
      "owner_user":         "ok",
      "default_warehouse":  "missing",
      ...
    }
  }
}
```

---

## Authentication

### POST /auth/login
```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000001","password":"password123"}'
```

Request:
```json
{ "phone": "+992900000001", "password": "password123" }
```

Response:
```json
{
  "success": true,
  "data": {
    "access_token":  "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in":    3600
  }
}
```

### POST /auth/refresh
```json
{ "refresh_token": "eyJ..." }
```

### POST /auth/logout
Requires `Authorization: Bearer <token>`.

---

## Users

### GET /users
Roles: `owner`

```bash
curl http://localhost:8080/api/v1/users?limit=50 \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Query params: `page`, `limit`, `role`, `search`

### GET /users/:id
Roles: `owner`

### POST /users
Roles: `owner`

```json
{
  "phone":     "+992901111111",
  "password":  "secret",
  "full_name": "New User",
  "role":      "seller"
}
```

### PUT /users/:id
Roles: `owner`

### DELETE /users/:id
Roles: `owner`

---

## Teams

### GET /teams
Roles: `owner`

### POST /teams
Roles: `owner`
```json
{ "name": "Team Alpha" }
```

### GET /teams/:id
### PUT /teams/:id
### DELETE /teams/:id

---

## Hierarchy

### POST /hierarchy
Roles: `owner`
```json
{ "user_id": "<uuid>", "team_id": "<uuid>", "manager_id": "<uuid>" }
```

### GET /hierarchy/:user_id
### DELETE /hierarchy/:user_id

---

## Products

### GET /products
Query: `search`, `category_id`, `is_active`, `page`, `limit`

```bash
curl "http://localhost:8080/api/v1/products?search=TEST-001&limit=1" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

### POST /products
Roles: `owner`, `warehouse_manager`
```json
{
  "sku":            "PROD-001",
  "name":           "Product Name",
  "sale_price":     150.00,
  "purchase_price": 60.00,
  "category_id":    "<uuid>",
  "supplier_id":    "<uuid>"
}
```

### GET /products/:id
### PUT /products/:id
### DELETE /products/:id

### GET /products/categories
### POST /products/categories
### GET /products/suppliers
### POST /products/suppliers

---

## Warehouse

### GET /warehouses
### POST /warehouses
Roles: `owner`, `warehouse_manager`
```json
{ "name": "Main Warehouse", "address": "City, Street 1" }
```

### GET /warehouses/:id
### PUT /warehouses/:id
### DELETE /warehouses/:id

---

## Inventory

### GET /inventory
Query: `warehouse_id`, `product_id`, `page`, `limit`

```bash
curl "http://localhost:8080/api/v1/inventory?warehouse_id=<uuid>" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

### POST /inventory/receive
Roles: `owner`, `warehouse_manager`
```json
{
  "warehouse_id": "<uuid>",
  "product_id":   "<uuid>",
  "quantity":     50,
  "reason":       "restock"
}
```

### GET /inventory/movements
Query: `warehouse_id`, `product_id`, `page`, `limit`

---

## Customers

### GET /customers
Roles: `owner`, `sales_team_lead`, `manager`, `seller`

```bash
curl http://localhost:8080/api/v1/customers \
  -H "Authorization: Bearer $SELLER_TOKEN"
```

### POST /customers
Roles: `owner`, `sales_team_lead`, `manager`, `seller`
```json
{
  "full_name": "John Doe",
  "phone":     "+992901234567",
  "source":    "manual"
}
```

### GET /customers/:id
### PUT /customers/:id

---

## Orders

### GET /orders
Roles: `owner`, `sales_team_lead`, `manager`, `seller`, `dispatcher`
Query: `status`, `seller_id`, `customer_id`, `page`, `limit`

```bash
curl http://localhost:8080/api/v1/orders \
  -H "Authorization: Bearer $SELLER_TOKEN"
```

### POST /orders
Roles: `owner`, `sales_team_lead`, `manager`, `seller`

```bash
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id":  "<uuid>",
    "warehouse_id": "<uuid>",
    "order_type":   "seller_order",
    "items": [
      { "product_id": "<uuid>", "quantity": 1, "unit_price": 100 }
    ]
  }'
```

Order types: `seller_order`, `return`, `exchange`

Response includes:
```json
{
  "id":             "<uuid>",
  "order_number":   "ORD-000001",
  "status":         "new",
  "total_amount":   100.00,
  "delivery_fee":   5.00,
  "net_revenue":    95.00,
  "prepayment_amount": 0
}
```

### GET /orders/:id
### PUT /orders/:id (partial update — notes, address)

### GET /orders/:id/timeline
All roles. Returns append-only status transition log.

### GET /orders/:id/snapshot
Roles: `owner`, `dispatcher`, `manager`, `sales_team_lead`

Returns the frozen financial snapshot created at order time:
```json
{
  "order_id":            "<uuid>",
  "seller_id":           "<uuid>",
  "manager_id":          "<uuid>",
  "team_lead_id":        "<uuid>",
  "total_amount":        100.00,
  "delivery_fee":        5.00,
  "net_revenue":         95.00,
  "tariff_fee":          5.00,
  "seller_rate":         0.05,
  "manager_team_rate":   0.03,
  "manager_personal_rate": 0.02,
  "team_lead_pool_rate": 0.02,
  "company_rate":        0.88
}
```

### POST /orders/:id/status
Direct status change (restricted roles per transition). Body:
```json
{ "status": "confirmed", "comment": "optional" }
```

---

## HR / Compensation

Base path: `/hr`

### GET /hr/commission-configs
Roles: `owner`

### POST /hr/commission-configs
Roles: `owner`
```json
{
  "commission_type": "seller_rate",
  "rate":            0.05,
  "team_id":         null,
  "user_id":         null
}
```

Commission types: `seller_rate`, `manager_team_rate`, `manager_personal_rate`, `team_lead_pool_rate`, `company_rate`

### GET /hr/delivery-tariffs
### POST /hr/delivery-tariffs
Roles: `owner`
```json
{ "fee": 5.00, "description": "Standard delivery" }
```

### GET /hr/events?order_id=<uuid>
Roles: `owner`

Returns all financial events generated when the order was delivered:

```bash
curl "http://localhost:8080/api/v1/hr/events?order_id=<uuid>" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Response:
```json
[
  { "event_type": "seller_commission_earned",       "amount": 4.75, "order_id": "<uuid>", ... },
  { "event_type": "manager_team_commission_earned", "amount": 2.85, "order_id": "<uuid>", ... },
  { "event_type": "team_lead_pool_earned",          "amount": 1.90, "order_id": "<uuid>", ... },
  { "event_type": "company_revenue_earned",         "amount": 83.60,"order_id": "<uuid>", ... }
]
```

Amounts satisfy: `amount = net_revenue × rate` (frozen from snapshot at order creation).

---

## Dispatcher Board

Base path: `/dispatch`  
All endpoints require role: `dispatcher` (or `owner`)

### GET /dispatch/board
Paginated board of actionable orders (statuses: confirmed, assigned, in_delivery).

```bash
curl http://localhost:8080/api/v1/dispatch/board \
  -H "Authorization: Bearer $DISPATCHER_TOKEN"
```

### POST /dispatch/orders/:id/confirm
Transition: `new` → `confirmed`

```bash
curl -X POST http://localhost:8080/api/v1/dispatch/orders/<id>/confirm \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### POST /dispatch/orders/:id/assign
Transition: `confirmed` → `assigned`. Creates `order_assignments` record.

```bash
curl -X POST http://localhost:8080/api/v1/dispatch/orders/<id>/assign \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"courier_id": "<uuid>", "note": "optional note"}'
```

Response includes assignment record with `id` field.

### POST /dispatch/orders/:id/reassign
Deactivates current assignment, creates new one. Body: same as assign.

### POST /dispatch/orders/:id/schedule
```json
{ "scheduled_at": "2026-06-10T09:00:00Z" }
```

### POST /dispatch/orders/:id/issue
Transition: `in_delivery` → `issue`
```json
{ "comment": "customer not reachable" }
```

### POST /dispatch/orders/:id/return
Transition: `in_delivery` or `issue` → `returned`

### POST /dispatch/orders/:id/cancel
Transition: `new`, `confirmed`, `issue` → `cancelled`

### POST /dispatch/orders/:id/resolve-issue
Transition: `issue` → target status
```json
{ "to_status": "assigned", "comment": "rescheduled" }
```

### GET /dispatch/couriers
List couriers with active assignment counts.

### GET /dispatch/cash/handovers
List all courier handovers (for dispatcher review).

### POST /dispatch/cash/handovers/:id/confirm
Roles: `dispatcher`, `owner`

```bash
curl -X POST http://localhost:8080/api/v1/dispatch/cash/handovers/<id>/confirm \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actual_returned": 95.00}'
```

If `|actual_returned - total_to_return| > 0.01`, status becomes `disputed`; otherwise `confirmed`.

### POST /dispatch/cash/handovers/:id/reject
```json
{ "reason": "amount mismatch" }
```

---

## Courier App

Base path: `/courier`  
All endpoints require role: `courier`

### GET /courier/orders
List the courier's active orders (non-terminal).

```bash
curl http://localhost:8080/api/v1/courier/orders \
  -H "Authorization: Bearer $COURIER_TOKEN"
```

### GET /courier/orders/available
Confirmed orders not yet assigned — courier can claim them.

### POST /courier/orders/:id/claim
Self-assign a confirmed order.

```bash
curl -X POST http://localhost:8080/api/v1/courier/orders/<id>/claim \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### POST /courier/orders/:id/start
Transition: `assigned` → `in_delivery`

```bash
curl -X POST http://localhost:8080/api/v1/courier/orders/<id>/start \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### POST /courier/orders/:id/delivered
Transition: `in_delivery` → `delivered`  
**Triggers financial events.** Net revenue is computed; all commission events are inserted atomically.

```bash
curl -X POST http://localhost:8080/api/v1/courier/orders/<id>/delivered \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### POST /courier/orders/:id/returned
Transition: `in_delivery` → `returned`

### POST /courier/orders/:id/issue
Transition: `in_delivery` → `issue`
```json
{ "comment": "wrong address" }
```

### POST /courier/orders/:id/attempt
Log a failed delivery attempt.

```json
{
  "result":  "no_answer",
  "comment": "rang twice, no answer"
}
```

Result values: `no_answer`, `busy`, `rescheduled`, `wrong_address`, `customer_cancelled`, `refused`, `other`

### POST /courier/notes
Add an immutable note to an order.
```json
{ "order_id": "<uuid>", "note": "Customer asked for evening delivery" }
```

### GET /courier/notes?order_id=<uuid>
List notes for an order.

### GET /courier/cash/summary
Returns aggregate totals for submitted-but-pending cash.

```bash
curl http://localhost:8080/api/v1/courier/cash/summary \
  -H "Authorization: Bearer $COURIER_TOKEN"
```

Response:
```json
{
  "total_collected":   100.00,
  "total_delivery_fee": 5.00,
  "total_to_return":    95.00,
  "pending_orders":     1
}
```

Formula:
- `courier_collected = total_amount - prepayment_amount`
- `courier_returns   = courier_collected - delivery_fee`

### POST /courier/cash/handover
Submit cash handover for all eligible delivered orders.

```bash
curl -X POST http://localhost:8080/api/v1/courier/cash/handover \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response:
```json
{
  "id":               "<uuid>",
  "status":           "pending",
  "total_collected":  100.00,
  "total_to_return":  95.00,
  "order_count":      1
}
```

Eligibility: `delivered` orders not already in a `pending` or `confirmed` handover.

### GET /courier/cash/handovers
List the courier's own handovers.

### GET /courier/status
Get current online status.

### POST /courier/status
```json
{ "status": "online" }
```

Status values: `online`, `offline`, `busy`

---

## Full Business Flow Walkthrough

```
1. Owner logs in, confirms readiness via GET /ready
2. Seller logs in, creates customer, creates order
   → Order status: new
   → Inventory reserved
   → Financial snapshot frozen
3. Dispatcher confirms order
   → Status: confirmed
4. Dispatcher assigns courier
   → Status: assigned
   → order_assignments record created (source of truth)
5. Courier starts delivery
   → Status: in_delivery
6. Courier marks delivered
   → Status: delivered
   → Financial events inserted:
       seller_commission_earned       = net_revenue × seller_rate
       manager_team_commission_earned = net_revenue × manager_team_rate
       team_lead_pool_earned          = net_revenue × team_lead_pool_rate
       company_revenue_earned         = net_revenue × company_rate
   → Inventory deducted (reservation cleared)
7. Dispatcher (or owner) fetches snapshot + events to verify amounts
   GET /orders/:id/snapshot
   GET /hr/events?order_id=:id
8. Courier submits handover
   POST /courier/cash/handover
9. Dispatcher confirms handover with actual amount
   POST /dispatch/cash/handovers/:id/confirm
   → If |actual - expected| ≤ 0.01 → confirmed
   → Otherwise → disputed
```

---

## Error Codes

| Code            | HTTP | Meaning                             |
|-----------------|------|-------------------------------------|
| BAD_REQUEST     | 400  | Invalid input / missing field       |
| UNAUTHORIZED    | 401  | Missing or invalid JWT              |
| FORBIDDEN       | 403  | Role not allowed for this action    |
| NOT_FOUND       | 404  | Resource does not exist             |
| CONFLICT        | 409  | Duplicate / constraint violation    |
| UNPROCESSABLE   | 422  | Business rule violation             |
| INTERNAL        | 500  | Unexpected server error             |

---

## Running the Full E2E Test

```bash
# 1. Start server
DB_DSN="postgres://..." go run ./cmd/server &

# 2. Seed (idempotent)
DB_DSN="postgres://..." go run ./cmd/seed

# 3. Run E2E script
BASE_URL=http://localhost:8080 bash scripts/e2e_flow.sh
```

Expected output (all green):
```
[STEP 01] Health check
  ✓ Server is up: ok
[STEP 02] Readiness check
  ✓ All readiness checks passed
...
══════════════════════════════════════════════════════════
  ✅  ALL 17 STEPS PASSED
══════════════════════════════════════════════════════════
```
