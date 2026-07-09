# Backend API Reference

Go + Gin + GORM + PostgreSQL backend (module `github.com/megamall/crm`), consumed by both the [web-admin website](WEB_ADMIN.md) and the [courier mobile app](../../mobile/courier-app/DOCUMENTATION.md). Every module lives in `internal/<name>/` with the standard split described in the root [`CLAUDE.md`](../CLAUDE.md): `model.go`, `dto.go`, `repository.go`, `service.go`, `handler.go`, `routes.go`.

All responses use the envelope `{success, data, meta, error}` (`pkg/response`). Errors are `*pkg/errors.AppError`. Auth is JWT; claims are `{user_id, role, team_id}`; role is one of `owner, sales_team_lead, manager, seller, dispatcher, warehouse_manager, courier`.

## Mounting

Everything is mounted under `router.Group("/api/v1")` in `cmd/server/main.go`, in this order, except one liveness probe mounted directly on the root router:

- `GET /health` (root, outside `/api/v1`) — plain `{"status":"ok"}`, no auth. Distinct from the `health` module's `/api/v1/health`.
- `GET /uploads/:filename` (root, outside `/api/v1`) — public static file server for uploaded files, with content-sniffing and path-traversal rejection.

Two modules are registered directly on the bare `v1` group (no additional prefix beyond what they define internally), which is easy to miss when reading `main.go`:
- **`products`** → its own routes are `/api/v1/suppliers/*` and `/api/v1/products/*`.
- **`logistics_settings`** → its own routes are `/api/v1/cities*` and `/api/v1/couriers/:id/payout`.

Modules with no HTTP surface at all: `activity` (audit-log writer used by other modules), `courier_tariffs` (logic reused by `dispatch` and `logistics_settings`), `uploads` (validation helpers only — the actual upload routes are inline in `main.go`), `seed` (demo-data CLI), `testutil` (test helpers).

---

## auth — `/api/v1/auth`

| Method | Path | Roles |
|---|---|---|
| POST | `/auth/login` | Public, rate-limited |
| POST | `/auth/refresh` | Public, rate-limited |
| POST | `/auth/logout` | Any authenticated |

## users — `/api/v1/users`

| Method | Path | Roles |
|---|---|---|
| GET | `/users/me` | Any authenticated |
| PATCH | `/users/me` | Any authenticated |
| POST | `/users/me/avatar` | Any authenticated |
| POST | `/users` | `owner` |
| GET | `/users` | `owner, manager, sales_team_lead` |
| GET | `/users/history` | `owner` |
| GET | `/users/:id/history` | `owner` |
| GET | `/users/:id` | Any authenticated (further scoped via `svc.CanViewUser`) |
| PATCH | `/users/:id` | `owner` |
| DELETE | `/users/:id` | `owner` |
| PATCH | `/users/:id/password` | Any authenticated (self, unless caller is `owner`) |
| POST | `/users/:id/avatar` | `owner` |
| GET/POST | `/users/:id/documents` | `owner` |
| PATCH | `/users/:id/documents/:document_id/status` | `owner` |
| DELETE | `/users/:id/documents/:document_id` | `owner` |

## teams — `/api/v1/teams`

| Method | Path | Roles |
|---|---|---|
| POST | `/teams` | `owner` |
| GET | `/teams` | `owner, sales_team_lead, manager` |
| GET | `/teams/:id` | `owner, sales_team_lead, manager` |
| PATCH | `/teams/:id` | `owner` |
| DELETE | `/teams/:id` | `owner` |

## hierarchy — `/api/v1/hierarchy`

| Method | Path | Roles |
|---|---|---|
| POST | `/hierarchy/assign` | `owner` |
| GET | `/hierarchy/user/:user_id` | `owner, sales_team_lead, manager` |
| GET | `/hierarchy/team/:team_id/members` | `owner, sales_team_lead, manager` |
| GET | `/hierarchy/my-team` | `owner, sales_team_lead, manager, seller` |

## compensation — `/api/v1/hr`

The commission/HR engine. See "Commission / compensation engine" in the root `CLAUDE.md` for the rate-resolution model (global → team → employee, `effective_from/to` windowing, frozen order-time snapshots).

| Method | Path | Roles |
|---|---|---|
| GET | `/hr/compensation/global` | Any authenticated |
| GET/POST | `/hr/compensation/configs` | `owner` |
| GET | `/hr/compensation/configs/:id` | `owner` |
| POST | `/hr/compensation/configs/:id/disable` | `owner` |
| GET | `/hr/compensation/history` | `owner` |
| GET | `/hr/compensation/employees/:user_id` | `owner` |
| GET | `/hr/compensation/teams/:team_id` | `owner` |
| GET | `/hr/compensation/preview` | `owner` |
| GET/POST | `/hr/compensation/employees/:user_id/salary` | `owner` |
| GET | `/hr/compensation/employees/:user_id/salary/history` | `owner` |
| GET | `/hr/compensation/me` | `owner, seller, manager, sales_team_lead` |
| GET | `/hr/events` | `owner, seller, manager, sales_team_lead` (scoped per-role in service) |
| GET | `/hr/income/me` | `owner, seller, manager, sales_team_lead` |
| GET | `/hr/income/me/team-rank` | `owner, seller, manager, sales_team_lead` |
| GET | `/hr/income/users/:id` | `owner, seller, manager, sales_team_lead` |
| GET | `/hr/income/teams/:id` | `owner, sales_team_lead` |

## products — mounted on bare `v1`, own prefixes `/api/v1/suppliers`, `/api/v1/products`

| Method | Path | Roles |
|---|---|---|
| GET | `/suppliers` | `owner, warehouse_manager` |
| POST/PATCH/DELETE | `/suppliers[/:id]` | `owner` |
| GET | `/products` | `owner, warehouse_manager, dispatcher, seller, manager, sales_team_lead` |
| POST | `/products` | `owner, warehouse_manager` |
| POST | `/products/import` | `owner, warehouse_manager` (registered before `/:id` to avoid route collision) |
| GET | `/products/:id` | `owner, warehouse_manager, dispatcher, seller, manager, sales_team_lead` |
| PATCH/DELETE | `/products/:id` | `owner, warehouse_manager` |
| POST/DELETE | `/products/:id/images[/:image_id]` | `owner, warehouse_manager` |

## inventory — `/api/v1/inventory`

| Method | Path | Roles |
|---|---|---|
| GET | `/inventory`, `/inventory/product/:id`, `/inventory/movements`, `/inventory/batches`, `/inventory/integrity`, `/inventory/receiving/:id/history` | `owner, warehouse_manager, dispatcher` |
| POST | `/inventory/receiving` | `owner, warehouse_manager` |
| PATCH | `/inventory/receiving/:id` | `owner, warehouse_manager` |
| POST | `/inventory/adjustments` | `owner, warehouse_manager` |
| POST | `/inventory/writeoffs` | `owner, warehouse_manager` |

## customers — `/api/v1/customers`

| Method | Path | Roles |
|---|---|---|
| GET/POST | `/customers` | `owner, sales_team_lead, manager, seller, dispatcher` |
| GET/PATCH | `/customers/:id` | `owner, sales_team_lead, manager, seller, dispatcher` |
| DELETE | `/customers/:id` | `owner, dispatcher` |
| GET | `/customers/:id/history` | `owner, sales_team_lead, manager, seller, dispatcher` |

`warehouse_manager` and `courier` have no access to this module by design.

## orders — `/api/v1/orders`

`warehouse_manager` is deliberately excluded from every order route (source comment: "P0 fix — Phase 24").

| Method | Path | Roles |
|---|---|---|
| GET/POST | `/orders` | `owner, sales_team_lead, manager, seller, dispatcher` |
| GET | `/orders/stats` | `owner, dispatcher` |
| GET/PATCH | `/orders/:id` | `owner, sales_team_lead, manager, seller, dispatcher` |
| GET | `/orders/:id/timeline` | `owner, sales_team_lead, manager, seller, dispatcher` |
| POST | `/orders/:id/status` | `owner, dispatcher, seller, manager, sales_team_lead` (transitions further enforced in `Service.ChangeStatus`) |
| GET/POST | `/orders/:id/prepayments` | `owner, sales_team_lead, manager, seller, dispatcher` (POST also `dispatcher`) |
| POST | `/orders/:id/prepayment/verify`, `/orders/:id/prepayment/reject` | `owner, dispatcher` |
| GET/POST | `/orders/:id/attachments` | `owner, sales_team_lead, manager, seller, dispatcher` |
| GET | `/orders/:id/snapshot` | `owner, dispatcher, manager, sales_team_lead` |
| GET/POST | `/orders/:id/comments` | `owner, sales_team_lead, manager, seller, dispatcher, courier` |

## dispatch — `/api/v1/dispatch`

The dispatcher board's backend. Every route requires `dispatcher` or `owner`, except tariff writes which are `owner`-only.

| Method | Path | Roles |
|---|---|---|
| GET | `/dispatch/board` | `dispatcher, owner` |
| GET | `/dispatch/couriers/overview`, `/dispatch/sellers` | `dispatcher, owner` |
| PUT | `/dispatch/couriers/:id` | `dispatcher, owner` |
| PATCH | `/dispatch/couriers/:id/active`, `/dispatch/couriers/:id/order-intake` | `dispatcher, owner` |
| GET | `/dispatch/couriers/:id/tariffs` | `dispatcher, owner` |
| POST/DELETE | `/dispatch/couriers/:id/tariffs[/:rule_id]` | `owner` only |
| GET | `/dispatch/cash/settlement`, `/dispatch/cash/transactions`, `/dispatch/history/orders` | `dispatcher, owner` |
| POST | `/dispatch/orders/:id/{confirm,assign,reassign,unassign,schedule,issue,resolve-issue,return,cancel}` | `dispatcher, owner` |
| GET/POST | `/dispatch/orders/:id/comments` | `dispatcher, owner` |
| GET | `/dispatch/cash/handovers` | `dispatcher, owner` |
| POST | `/dispatch/cash/handovers/:id/{confirm,reject}` | `dispatcher, owner` |
| POST | `/dispatch/cash/transactions/:id/{confirm,reject}` | `dispatcher, owner` |

## courier — `/api/v1/courier`

Backend for [the mobile courier app](../../mobile/courier-app/DOCUMENTATION.md) and the web `/courier` fallback view. Every route requires `courier` or `owner`.

| Method | Path |
|---|---|
| GET | `/courier/me` |
| GET | `/courier/my-orders` |
| GET | `/courier/available` |
| POST | `/courier/available/:id/claim` |
| GET | `/courier/orders/:id` |
| POST | `/courier/orders/:id/start` |
| POST | `/courier/orders/:id/delivered` |
| POST | `/courier/orders/:id/returned` |
| POST | `/courier/orders/:id/issue` |
| POST | `/courier/orders/:id/address-changed` |
| POST | `/courier/orders/:id/defer` |
| GET/POST | `/courier/orders/:id/notes` |
| POST | `/courier/orders/:id/attempt` |
| GET | `/courier/cash/summary` |
| POST | `/courier/cash/handover` |
| GET | `/courier/cash/handovers` |
| POST | `/courier/status` |
| PUT | `/courier/push-token` |

## delivery_settings — `/api/v1/settings/delivery`

| Method | Path | Roles |
|---|---|---|
| GET | `/settings/delivery` | Any authenticated |
| PUT | `/settings/delivery` | `owner` (checked in-handler) |

## finance — `/api/v1/finance`

All routes `owner`-only.

| Method | Path |
|---|---|
| GET | `/finance/summary`, `/finance/events`, `/finance/cash`, `/finance/daily`, `/finance/sellers`, `/finance/teams` |
| GET/POST | `/finance/expenses` |
| PATCH | `/finance/expenses/:id` |
| GET | `/finance/expenses/:id/history` |

See "The financial ledger constraint" in the root `CLAUDE.md`: `financial_events.order_id` is `NOT NULL, ON DELETE RESTRICT`; anything not tied to a real order (manual expenses, payouts) lives in a dedicated table and is UNIONed into `ListFinancialEvents`.

## budget — `/api/v1/owner/budget`

Company-level ledger independent of orders. All routes `owner`-only.

| Method | Path |
|---|---|
| GET | `/owner/budget/summary`, `/owner/budget/transactions`, `/owner/budget/creators` |
| POST | `/owner/budget/income`, `/owner/budget/withdrawal` |
| PATCH | `/owner/budget/transaction/:id` |
| GET | `/owner/budget/transaction/:id/history` |

## logistics — `/api/v1/owner/logistics`

Owner's courier-performance/cash-handover console. All routes `owner`-only.

| Method | Path |
|---|---|
| GET | `/owner/logistics/dashboard`, `/owner/logistics/couriers[/:id]`, `/owner/logistics/couriers/:id/orders`, `/owner/logistics/couriers/:id/performance` |
| GET/POST | `/owner/logistics/cash-handovers` |
| PATCH/DELETE | `/owner/logistics/cash-handovers/:id` |

## logistics_settings — mounted on bare `v1`, own prefixes `/api/v1/cities`, `/api/v1/couriers/:id/payout`

Auth required for all; owner-only writes are checked inside the handler rather than via `RequireRoles`.

| Method | Path | Roles |
|---|---|---|
| GET | `/cities` | Any authenticated |
| POST/PATCH | `/cities[/:id]` | `owner` (in-handler) |
| GET/PUT | `/couriers/:id/payout` | `owner` (in-handler) |

## payouts — `/api/v1/payouts`

Generalized payout ledger for team-lead→seller/manager flows. `manager` is deliberately excluded from payer-only routes (no UI drives a manager-pays-seller flow yet, though the schema supports it).

| Method | Path | Roles |
|---|---|---|
| GET | `/payouts/me` | `owner, seller, manager, sales_team_lead` |
| POST | `/payouts` | `owner, sales_team_lead` |
| GET | `/payouts/payables/team-lead/:id` | `owner, sales_team_lead` |
| GET | `/payouts/payee/:payeeId` | `owner, sales_team_lead` |
| POST | `/payouts/:id/void` | `owner, sales_team_lead` |

## uploads — inline in `main.go`, no module prefix

| Method | Path | Roles |
|---|---|---|
| POST | `/api/v1/uploads` | Any authenticated |
| GET | `/uploads/:filename` (root, outside `/api/v1`) | Public — re-sniffs bytes, rejects path traversal |

## health — `/api/v1/health`, `/api/v1/ready`

Both public, no auth.

---

## Cross-reference

- Frontend consumption of these endpoints, organized by web-admin feature, is documented in [WEB_ADMIN.md](WEB_ADMIN.md).
- Courier-app consumption is documented in [`mobile/courier-app/DOCUMENTATION.md`](../../mobile/courier-app/DOCUMENTATION.md).
- Module implementation conventions (file split, RBAC pattern, migrations, financial ledger constraint, compensation engine) are documented in the root [`CLAUDE.md`](../CLAUDE.md).
