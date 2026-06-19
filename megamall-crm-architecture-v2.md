# MEGAMALL CRM — MASTER ARCHITECTURE DOCUMENT
**Version 2.0 | Dynamic Commission & HR Compensation System**

> Supersedes v1.0. All changes from the ARCHITECTURE UPDATE are incorporated.
> Sections modified: Part 0 (new challenge), Part 2 (DB schema), Part 4 (backend modules),
> Part 5 (API), Part 8 (Financial Engine), Part 12 (Reporting), Part 13 (Activity Logs).
> New sections added: Part 16 (HR Compensation Module), Part 17 (Rate Resolution Algorithm).

---

## PART 0: CTO REVIEW — CHALLENGES & DECISIONS

### Challenge 1: SQLite → PostgreSQL Migration Risk
Your existing system runs SQLite. New system uses PostgreSQL. Commission calculation queries (multi-join aggregates across orders, roles, tariffs) will be slow without proper indexing from day one. Index recommendations included throughout.

### Challenge 2: Financial Engine Complexity is Underestimated
The commission model has recursive dependencies. A single order creation triggers 4–5 financial ledger writes. You cannot calculate this on-the-fly at query time at scale. **Decision: event-sourced financial ledger** — every status change appends a financial event. Reports read from the ledger, not from joins.

### Challenge 3: "One Backend" Needs Module Boundaries
One Go binary is correct. But hard module separation is required internally. Domain-driven structure enforced in Part 4.

### Challenge 4: Expo "Offline Support" Scope
**Decision: V1 = read-only cache with "no connection" banner. V2 = offline writes with sync.**

### Challenge 5: "Russian Only" is Too Simple for SaaS
**Decision: all strings through translation keys from day one. Two days now, avoids full rewrite later.**

### Challenge 6: No Audit Trail for Financial Disputes
**Decision: immutable financial_events table + separate cash_handovers dispute flow.**

### Challenge 7 (NEW — v2.0): Dynamic Rates Create a Three-Layer Resolution Problem
When the financial engine runs for an order, it must answer: *which rate applies?* Three layers exist:
1. **Employee-level override** — highest priority
2. **Team-level config** — overrides global if no employee override
3. **Global default** — fallback

This resolution must happen at **order creation time**, not at delivery time. The resolved rates are frozen into an immutable snapshot stored with the order. Rate changes after order creation can never affect that order.

**Decision: Two-table rate system.** `commission_configs` stores all configurable rates with full history. `order_financial_snapshots` stores the frozen resolved snapshot per order. Financial engine reads ONLY from snapshots — never from `commission_configs` during calculation.

### Challenge 8 (NEW — v2.0): Rate Scheduling is Underspecified
The spec says "schedule future changes." This means `effective_from` can be a future date. The system needs a resolver that correctly picks the rate active at any given timestamp — including past timestamps for historical recalculation.

**Decision: Closed-interval rate windows.** `effective_from` + `effective_to`. When a new rate is set, the system automatically closes the previous rate's `effective_to`. A NULL `effective_to` means "currently active." Resolver query uses `effective_from <= target_ts AND (effective_to IS NULL OR effective_to > target_ts)`.

---

## PART 1: COMPLETE SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                            │
│                                                              │
│  React Web App (Vite)        │    Expo App (Courier)         │
│  - Owner CRM                 │    - Android                  │
│    └── HR / Compensation     │    - iOS                      │
│  - Sales TL Panel            │    - Web                      │
│  - Manager Panel             │                               │
│  - Seller Panel              │                               │
│  - Dispatcher Panel          │                               │
│  - Warehouse Panel           │                               │
└──────────────┬───────────────┴────────────┬─────────────────┘
               │                            │
               │       HTTPS / WSS          │
               ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                API GATEWAY LAYER (Nginx)                     │
│  TLS termination · Rate limiting · Static asset serving      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  GO BACKEND (Gin + Gorm)                     │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │  Auth    │ │  Orders  │ │ Finance  │ │Warehouse │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Dispatch  │ │ Courier  │ │   HR /   │ │Reporting │        │
│  │          │ │          │ │Compensat.│ │          │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐                                   │
│  │Notif.    │ │Activity  │                                   │
│  └──────────┘ └──────────┘                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
               ┌───────────┼───────────┐
               ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │PostgreSQL│ │  Redis   │ │S3/Minio  │
        │  (main)  │ │(cache+WS)│ │  (files) │
        └──────────┘ └──────────┘ └──────────┘
```

---

## PART 2: DATABASE DESIGN

### Naming Conventions
- snake_case everywhere
- All tables: `id UUID PK`, `created_at`, `updated_at`, `deleted_at` (soft delete)
- Financial + audit tables: **NO soft delete — hard immutability, NO updated_at**

---

### 2.1 USERS & ROLES (unchanged from v1.0)

```sql
users
  id            UUID PK
  phone         VARCHAR(20) UNIQUE NOT NULL
  email         VARCHAR(255) UNIQUE
  password_hash VARCHAR(255) NOT NULL
  full_name     VARCHAR(255) NOT NULL
  role          ENUM(owner, sales_team_lead, manager, seller,
                     dispatcher, warehouse_manager, courier)
  is_active     BOOLEAN DEFAULT true
  avatar_url    VARCHAR(500)
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ
  deleted_at    TIMESTAMPTZ

user_hierarchy
  id            UUID PK
  user_id       UUID FK → users
  parent_id     UUID FK → users
  team_id       UUID FK → teams
  created_at    TIMESTAMPTZ

teams
  id            UUID PK
  name          VARCHAR(255)
  team_lead_id  UUID FK → users
  manager_id    UUID FK → users
  is_active     BOOLEAN
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ

courier_devices
  id            UUID PK
  courier_id    UUID FK → users
  device_token  VARCHAR(500)
  platform      ENUM(android, ios, web)
  last_seen     TIMESTAMPTZ
```

---

### 2.2 CUSTOMERS (unchanged from v1.0)

```sql
customers
  id            UUID PK
  full_name     VARCHAR(255) NOT NULL
  phone         VARCHAR(20) NOT NULL
  phone_alt     VARCHAR(20)
  address       TEXT
  city          VARCHAR(100)
  notes         TEXT
  source        ENUM(instagram, facebook, tiktok, website, phone, other)
  total_orders  INT DEFAULT 0
  created_by    UUID FK → users
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ
  deleted_at    TIMESTAMPTZ
```

---

### 2.3 PRODUCTS & INVENTORY (unchanged from v1.0)

```sql
products
  id             UUID PK
  name           VARCHAR(255) NOT NULL
  sku            VARCHAR(100) UNIQUE
  description    TEXT
  cost_price     NUMERIC(12,2)
  sale_price     NUMERIC(12,2)
  image_url      VARCHAR(500)
  is_active      BOOLEAN
  created_at     TIMESTAMPTZ
  updated_at     TIMESTAMPTZ
  deleted_at     TIMESTAMPTZ

warehouses
  id             UUID PK
  name           VARCHAR(255)
  address        TEXT
  manager_id     UUID FK → users
  is_active      BOOLEAN

inventory
  id             UUID PK
  product_id     UUID FK → products
  warehouse_id   UUID FK → warehouses
  quantity       INT NOT NULL DEFAULT 0
  reserved_qty   INT NOT NULL DEFAULT 0
  updated_at     TIMESTAMPTZ
  UNIQUE(product_id, warehouse_id)

inventory_movements
  id             UUID PK
  product_id     UUID FK → products
  warehouse_id   UUID FK → warehouses
  type           ENUM(in, out, transfer, writeoff, return)
  quantity       INT NOT NULL
  reference_id   UUID
  reference_type VARCHAR(50)
  notes          TEXT
  created_by     UUID FK → users
  created_at     TIMESTAMPTZ
```

---

### 2.4 ORDERS (UPDATED)

```sql
orders
  id               UUID PK
  order_number     VARCHAR(50) UNIQUE NOT NULL
  order_type       ENUM(seller_order, manager_personal_order,
                        team_lead_personal_order)
  source           ENUM(instagram, facebook, tiktok, website, phone, other)

  customer_id      UUID FK → customers
  seller_id        UUID FK → users
  team_id          UUID FK → teams

  status           ENUM(new, confirmed, dispatched, in_delivery,
                        delivered, returned, cancelled, issue)

  -- Financial (gross)
  total_amount     NUMERIC(12,2) NOT NULL
  prepayment       NUMERIC(12,2) DEFAULT 0
  delivery_fee     NUMERIC(12,2) NOT NULL     -- resolved at creation
  net_revenue      NUMERIC(12,2) NOT NULL     -- computed: total - delivery_fee

  -- Rate snapshot reference (NEW v2.0)
  snapshot_id      UUID FK → order_financial_snapshots

  courier_id       UUID FK → users
  scheduled_at     TIMESTAMPTZ
  delivered_at     TIMESTAMPTZ

  notes            TEXT
  cancellation_reason TEXT
  prepayment_proof_url VARCHAR(500)

  created_at       TIMESTAMPTZ
  updated_at       TIMESTAMPTZ
  deleted_at       TIMESTAMPTZ

order_items
  id               UUID PK
  order_id         UUID FK → orders
  product_id       UUID FK → products
  warehouse_id     UUID FK → warehouses
  quantity         INT NOT NULL
  unit_price       NUMERIC(12,2) NOT NULL
  total_price      NUMERIC(12,2) NOT NULL

order_status_history
  id               UUID PK
  order_id         UUID FK → orders
  from_status      VARCHAR(50)
  to_status        VARCHAR(50) NOT NULL
  changed_by       UUID FK → users
  notes            TEXT
  created_at       TIMESTAMPTZ   -- IMMUTABLE
```

---

### 2.5 COMMISSION CONFIGURATION SYSTEM (NEW — v2.0)

This is the heart of the dynamic rate system.

```sql
-- ─────────────────────────────────────────────────────────
-- COMMISSION CONFIGS
-- Stores ALL commission rates at every level.
-- Three mutually exclusive scopes per row:
--   1. user_id IS NOT NULL → employee-level
--   2. team_id IS NOT NULL, user_id IS NULL → team-level
--   3. Both NULL → global default
-- ─────────────────────────────────────────────────────────
commission_configs
  id               UUID PK
  organization_id  UUID NOT NULL              -- SaaS-ready tenant key
  team_id          UUID FK → teams  NULLABLE  -- team-level scope
  user_id          UUID FK → users  NULLABLE  -- employee-level scope
  commission_type  ENUM(
                     seller_rate,
                     manager_team_rate,
                     manager_personal_rate,
                     team_lead_pool_rate,
                     company_rate
                   ) NOT NULL
  rate             NUMERIC(6,5) NOT NULL      -- e.g. 0.10000 = 10%
  effective_from   TIMESTAMPTZ NOT NULL
  effective_to     TIMESTAMPTZ NULLABLE       -- NULL = currently active
  notes            TEXT                       -- reason for change
  created_by       UUID FK → users
  created_at       TIMESTAMPTZ                -- IMMUTABLE
  -- NO updated_at, NO deleted_at
  -- Changes create NEW rows, never mutate old rows

-- Constraint: only one NULL effective_to per (org, scope, type)
-- Enforced via partial unique index:
CREATE UNIQUE INDEX uq_active_commission
  ON commission_configs (organization_id, COALESCE(team_id,'00000000-0000-0000-0000-000000000000'),
                         COALESCE(user_id,'00000000-0000-0000-0000-000000000000'), commission_type)
  WHERE effective_to IS NULL;
```

**Indexes:**
```sql
-- Rate resolution query (most critical path)
CREATE INDEX idx_commission_configs_resolution
  ON commission_configs (organization_id, commission_type, user_id, team_id,
                         effective_from, effective_to);

-- History queries
CREATE INDEX idx_commission_configs_user
  ON commission_configs (user_id, commission_type, effective_from DESC);

CREATE INDEX idx_commission_configs_team
  ON commission_configs (team_id, commission_type, effective_from DESC);
```

---

### 2.6 DELIVERY TARIFF CONFIGURATION (UPDATED)

```sql
-- Tariff header
delivery_tariffs
  id               UUID PK
  organization_id  UUID NOT NULL
  name             VARCHAR(100) NOT NULL
  type             ENUM(fixed, tiered) NOT NULL
  is_active        BOOLEAN DEFAULT true
  effective_from   TIMESTAMPTZ NOT NULL
  effective_to     TIMESTAMPTZ NULLABLE    -- NULL = currently active
  notes            TEXT
  created_by       UUID FK → users
  created_at       TIMESTAMPTZ             -- IMMUTABLE
  -- No updates — changes create new tariff records

-- Tariff ranges (only used when type = tiered)
delivery_tariff_ranges
  id               UUID PK
  tariff_id        UUID FK → delivery_tariffs
  min_amount       NUMERIC(12,2) NOT NULL
  max_amount       NUMERIC(12,2) NULLABLE  -- NULL = no upper bound
  fee              NUMERIC(12,2) NOT NULL
  sort_order       INT NOT NULL DEFAULT 0

-- Fixed fee stored directly on delivery_tariffs when type = fixed:
-- Add column: fixed_fee NUMERIC(12,2) NULLABLE
-- Only populated when type = fixed
```

---

### 2.7 ORDER FINANCIAL SNAPSHOTS (NEW — v2.0)

This table is the immutability guarantee. Created once at order creation, never changed.

```sql
order_financial_snapshots
  id                      UUID PK
  order_id                UUID FK → orders UNIQUE

  -- Resolved rates (frozen at order.created_at)
  seller_rate             NUMERIC(6,5)    -- e.g. 0.10000
  manager_team_rate       NUMERIC(6,5)    -- e.g. 0.03000
  manager_personal_rate   NUMERIC(6,5)    -- e.g. 0.20000
  team_lead_pool_rate     NUMERIC(6,5)    -- e.g. 0.40000
  company_rate            NUMERIC(6,5)    -- e.g. 0.60000

  -- Resolved tariff
  tariff_id               UUID FK → delivery_tariffs
  tariff_type             ENUM(fixed, tiered)
  tariff_fee              NUMERIC(12,2)   -- the actual fee amount resolved

  -- Rate source tracing (for audit/reporting)
  seller_rate_source      ENUM(employee, team, global)
  manager_team_rate_source ENUM(employee, team, global)
  manager_personal_rate_source ENUM(employee, team, global)
  team_lead_pool_rate_source   ENUM(employee, team, global)
  company_rate_source     ENUM(employee, team, global)

  -- Config IDs that were used (for traceability)
  seller_config_id        UUID FK → commission_configs
  manager_team_config_id  UUID FK → commission_configs
  manager_personal_config_id UUID FK → commission_configs
  team_lead_pool_config_id   UUID FK → commission_configs
  company_config_id       UUID FK → commission_configs
  
  -- Full denormalized JSON (backup, human-readable)
  snapshot_json           JSONB NOT NULL

  created_at              TIMESTAMPTZ    -- IMMUTABLE
  -- NO updated_at. NEVER modified after creation.
```

**Example `snapshot_json`:**
```json
{
  "resolved_at": "2026-01-15T09:30:00Z",
  "seller": { "rate": 0.10, "source": "employee", "config_id": "uuid-abc" },
  "manager_team": { "rate": 0.03, "source": "team", "config_id": "uuid-def" },
  "manager_personal": { "rate": 0.20, "source": "employee", "config_id": "uuid-ghi" },
  "team_lead_pool": { "rate": 0.40, "source": "global", "config_id": "uuid-jkl" },
  "company": { "rate": 0.60, "source": "global", "config_id": "uuid-mno" },
  "tariff": { "id": "uuid-pqr", "type": "tiered", "fee": 20.00 }
}
```

---

### 2.8 FINANCIAL LEDGER (UPDATED)

```sql
financial_events
  id               UUID PK
  order_id         UUID FK → orders
  snapshot_id      UUID FK → order_financial_snapshots  -- (NEW v2.0)
  event_type       ENUM(
                     seller_commission_earned,
                     seller_commission_confirmed,
                     seller_commission_cancelled,
                     manager_team_commission_earned,
                     manager_team_commission_confirmed,
                     manager_personal_commission_earned,
                     manager_personal_commission_confirmed,
                     team_lead_pool_earned,
                     team_lead_pool_confirmed,
                     courier_fee_earned,
                     courier_fee_confirmed,
                     company_revenue_earned,
                     company_revenue_confirmed,
                     cash_collected,
                     cash_handed_over
                   )
  user_id          UUID FK → users
  amount           NUMERIC(12,2) NOT NULL
  metadata         JSONB   -- rates used, calculation steps
  created_at       TIMESTAMPTZ  -- IMMUTABLE

cash_handovers
  id               UUID PK
  courier_id       UUID FK → users
  dispatcher_id    UUID FK → users
  total_collected  NUMERIC(12,2)
  total_fees       NUMERIC(12,2)
  total_returned   NUMERIC(12,2)
  status           ENUM(pending, confirmed, disputed)
  notes            TEXT
  confirmed_at     TIMESTAMPTZ
  created_at       TIMESTAMPTZ

cash_handover_orders
  id               UUID PK
  handover_id      UUID FK → cash_handovers
  order_id         UUID FK → orders
  amount_collected NUMERIC(12,2)
  courier_fee      NUMERIC(12,2)
```

---

### 2.9 NOTIFICATIONS & ACTIVITY LOGS (unchanged from v1.0)

```sql
notifications
  id               UUID PK
  user_id          UUID FK → users
  type             VARCHAR(100)
  title            VARCHAR(255)
  body             TEXT
  data             JSONB
  is_read          BOOLEAN DEFAULT false
  read_at          TIMESTAMPTZ
  created_at       TIMESTAMPTZ

activity_logs
  id               UUID PK
  actor_id         UUID FK → users
  action           VARCHAR(100)
  entity_type      VARCHAR(50)
  entity_id        UUID
  before_state     JSONB
  after_state      JSONB
  ip_address       INET
  user_agent       TEXT
  reason           TEXT        -- (NEW v2.0) required for compensation changes
  created_at       TIMESTAMPTZ -- IMMUTABLE
```

---

## PART 3: RBAC PERMISSIONS MATRIX (UPDATED)

| Action | owner | sales_tl | manager | seller | dispatcher | warehouse | courier |
|--------|-------|----------|---------|--------|------------|-----------|---------|
| Create order | ✓ | ✓ | ✓ | ✓ | - | - | - |
| View own orders | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ |
| View team orders | ✓ | ✓ | ✓ | - | ✓ | - | - |
| View all orders | ✓ | - | - | - | ✓ | - | - |
| Confirm order | ✓ | - | - | - | ✓ | - | - |
| Assign courier | ✓ | - | - | - | ✓ | - | - |
| Update delivery status | ✓ | - | - | - | ✓ | - | ✓ |
| View own earnings | ✓ | ✓ | ✓ | ✓ | - | - | ✓ |
| View team earnings | ✓ | ✓ | ✓ | - | - | - | - |
| View all earnings | ✓ | - | - | - | - | - | - |
| Manage products | ✓ | - | - | - | - | ✓ | - |
| Manage inventory | ✓ | - | - | - | - | ✓ | - |
| View inventory | ✓ | - | - | - | ✓ | ✓ | - |
| Manage users | ✓ | - | - | - | - | - | - |
| **View commission configs** | ✓ | own | own | own | - | - | - |
| **Create commission config** | ✓ | - | - | - | - | - | - |
| **Edit commission config** | ✓ | - | - | - | - | - | - |
| **Disable commission config** | ✓ | - | - | - | - | - | - |
| **View tariffs** | ✓ | ✓ | ✓ | - | ✓ | - | - |
| **Create/edit tariffs** | ✓ | - | - | - | - | - | - |
| **View rate history** | ✓ | team | team | own | - | - | - |
| **View snapshots** | ✓ | - | - | - | - | - | - |
| Cash handover | ✓ | - | - | - | ✓ | - | ✓ |
| View activity logs | ✓ | - | - | - | - | - | - |
| Export reports | ✓ | team | team | - | - | ✓ | - |

---

## PART 4: BACKEND MODULES (UPDATED)

```
/cmd
  /server              -- main.go, router

/internal
  /auth                -- JWT, sessions, refresh tokens
  /users               -- user CRUD, hierarchy, teams
  /orders              -- order lifecycle, status machine
  /finance             -- financial engine, ledger writes
  /compensation        -- (NEW v2.0) commission configs, tariffs,
  │                       rate resolver, snapshot builder
  /dispatch            -- dispatcher operations
  /courier             -- courier mobile endpoints
  /warehouse           -- products, inventory, movements
  /hr                  -- employee management, performance (links to compensation)
  /reporting           -- analytics, exports, rate impact reports
  /notifications       -- push, in-app, Telegram
  /activity            -- audit log writes
  /realtime            -- WebSocket hub

/pkg
  /middleware          -- auth, rbac, rate limit, logging
  /database            -- gorm, migrations
  /cache               -- redis client
  /storage             -- S3/Minio
  /validator           -- request validation
  /errors              -- standardized error types
  /pagination          -- cursor/offset helpers
```

### Compensation Module — Internal Structure

```
/internal/compensation
  resolver.go          -- RateResolver: resolves active rate for any user/team/timestamp
  snapshot.go          -- SnapshotBuilder: builds order_financial_snapshot at order creation
  tariff.go            -- TariffCalculator: resolves delivery fee from tariff config
  config_service.go    -- CRUD for commission_configs with history management
  tariff_service.go    -- CRUD for delivery_tariffs
  scheduler.go         -- future rate activations (cron job, checks effective_from)
  history.go           -- rate history queries for reporting
```

---

## PART 5: API DESIGN (UPDATED)

### Conventions (unchanged)
- Base URL: `/api/v1/`
- Auth: `Authorization: Bearer <JWT>`
- Response envelope: `{ success, data, meta, error }`

### Core Order/Finance/Dispatch Endpoints (unchanged from v1.0)

**Auth**
```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
```

**Orders**
```
GET    /orders
POST   /orders
GET    /orders/:id
PATCH  /orders/:id/status
PATCH  /orders/:id
DELETE /orders/:id
GET    /orders/:id/history
GET    /orders/:id/snapshot      -- (NEW) view financial snapshot
POST   /orders/:id/prepayment-proof
```

**Dispatch**
```
GET    /dispatch/board
POST   /dispatch/:id/confirm
POST   /dispatch/:id/assign-courier
POST   /dispatch/:id/reschedule
```

**Courier**
```
GET    /courier/my-orders
GET    /courier/available
POST   /courier/orders/:id/pickup
POST   /courier/orders/:id/deliver
POST   /courier/orders/:id/return
POST   /courier/cash/handover
GET    /courier/cash/summary
```

---

### HR / Compensation Endpoints (NEW — v2.0)

**Commission Configs**
```
-- Global defaults
GET    /hr/compensation/global
  Response: { seller_rate, manager_team_rate, manager_personal_rate,
               team_lead_pool_rate, company_rate } (active rates)

-- Team-level configs
GET    /hr/compensation/teams/:team_id
PUT    /hr/compensation/teams/:team_id
  Body: { commission_type, rate, effective_from, notes }

-- Employee-level configs
GET    /hr/compensation/employees/:user_id
  Response: all commission_configs for this user, current + history
PUT    /hr/compensation/employees/:user_id
  Body: { commission_type, rate, effective_from, notes }

-- Shared operations
POST   /hr/compensation/configs
  Body: {
    scope: "global" | "team" | "employee",
    team_id?: uuid,
    user_id?: uuid,
    commission_type: string,
    rate: number,
    effective_from: datetime,
    notes: string
  }
  Action: closes current active config (sets effective_to = effective_from - 1ms),
           inserts new config row. All in one transaction.

POST   /hr/compensation/configs/:id/disable
  Body: { effective_to: datetime, notes: string }

GET    /hr/compensation/history
  Query: ?user_id=&team_id=&commission_type=&from=&to=
  Response: paginated list of commission_configs with actor details

GET    /hr/compensation/preview
  Query: ?user_id=&team_id=&order_total=&order_type=
  Response: simulates what commissions would look like with current rates
  Use case: Owner preview before saving new rates
```

**Delivery Tariffs**
```
GET    /hr/tariffs
  Response: all tariffs (active + historical)

GET    /hr/tariffs/active
  Response: single currently active tariff with ranges

POST   /hr/tariffs
  Body: {
    name: string,
    type: "fixed" | "tiered",
    fixed_fee?: number,
    ranges?: [{ min_amount, max_amount, fee }],
    effective_from: datetime,
    notes: string
  }
  Action: sets effective_to on current active tariff, inserts new

GET    /hr/tariffs/:id
POST   /hr/tariffs/:id/deactivate
  Body: { effective_to: datetime, notes: string }

GET    /hr/tariffs/history
  Query: ?from=&to=
```

**Reporting (compensation-specific)**
```
GET    /hr/compensation/report/current-rates
  Response: table of all current rates across all teams + employees

GET    /hr/compensation/report/changes
  Query: ?from=&to=&changed_by=
  Response: all rate changes in period with before/after and actor

GET    /hr/compensation/report/impact
  Query: ?config_id=&from=&to=
  Response: financial impact — how many orders used this config,
             total commissions paid, before/after comparison
```

---

## PART 16: HR COMPENSATION MODULE (NEW — v2.0)

### Module Responsibilities

1. **Configuration CRUD** — Create, read, disable compensation configs
2. **Rate Resolution** — Determine the correct rate for any (user, type, timestamp)
3. **Snapshot Building** — Freeze resolved rates at order creation
4. **History Tracking** — Immutable record of every rate change
5. **Reporting** — Rate change history, impact analysis

---

### 16.1 Rate Resolution Algorithm

This is the most critical piece of logic in the compensation module.

```
RateResolver.Resolve(
  organization_id UUID,
  user_id         UUID,    -- the seller/manager/TL
  team_id         UUID,    -- their team
  commission_type string,  -- "seller_rate", "manager_team_rate", etc.
  at_time         time.Time
) → (rate float64, source string, config_id UUID, error)

ALGORITHM:
  Priority 1 — Employee-level:
    SELECT rate, id FROM commission_configs
    WHERE organization_id = $org
      AND user_id = $user_id
      AND commission_type = $type
      AND effective_from <= $at_time
      AND (effective_to IS NULL OR effective_to > $at_time)
    ORDER BY effective_from DESC
    LIMIT 1
    → IF found: return (rate, "employee", id)

  Priority 2 — Team-level:
    SELECT rate, id FROM commission_configs
    WHERE organization_id = $org
      AND team_id = $team_id
      AND user_id IS NULL
      AND commission_type = $type
      AND effective_from <= $at_time
      AND (effective_to IS NULL OR effective_to > $at_time)
    ORDER BY effective_from DESC
    LIMIT 1
    → IF found: return (rate, "team", id)

  Priority 3 — Global default:
    SELECT rate, id FROM commission_configs
    WHERE organization_id = $org
      AND team_id IS NULL
      AND user_id IS NULL
      AND commission_type = $type
      AND effective_from <= $at_time
      AND (effective_to IS NULL OR effective_to > $at_time)
    ORDER BY effective_from DESC
    LIMIT 1
    → IF found: return (rate, "global", id)

  → IF NONE FOUND: return error("NO_RATE_CONFIGURED")
    — This must be caught at order creation time, not at delivery time
    — Owner must configure at minimum global defaults before system goes live
```

---

### 16.2 Snapshot Builder

Called at order creation, **inside the order creation transaction**.

```
SnapshotBuilder.BuildAndSave(order Order) → (snapshot_id UUID, error)

STEPS:
  1. Resolve all 5 rates via RateResolver (all use order.created_at as at_time)
     - seller_rate       → resolve for order.seller_id
     - manager_team_rate → resolve for order.manager_id (from hierarchy)
     - manager_personal_rate → resolve for order.manager_id
     - team_lead_pool_rate   → resolve for order.team_lead_id (from hierarchy)
     - company_rate      → resolve for organization_id (always global)

  2. Resolve delivery_fee via TariffCalculator
     - Look up active tariff at order.created_at
     - Apply fee based on order.total_amount

  3. Insert order_financial_snapshots row with all resolved values
     - Including source (employee/team/global) for each rate
     - Including config_id references for audit trail
     - Including full snapshot_json

  4. Set order.delivery_fee = resolved delivery_fee
  5. Set order.net_revenue = order.total_amount - order.delivery_fee
  6. Set order.snapshot_id = new snapshot.id

  ALL ABOVE IN SINGLE TRANSACTION.
  If any resolution fails → order creation fails with clear error.
```

---

### 16.3 Rate Change Workflow (Owner UI → Backend)

```
Owner wants to change Seller Ali's commission from 10% to 12% effective April 1:

1. Owner opens: HR → Compensation → Employees → Ali → seller_rate
2. Owner sees current rate: 10% (since Jan 1, 2026)
3. Owner enters: New Rate = 12%, Effective From = 2026-04-01, Reason = "Q2 raise"
4. Owner clicks "Save"

Backend POST /hr/compensation/configs:
  BEGIN TRANSACTION
    a. SELECT current active config for (Ali, seller_rate) → config A (10%, eff_from Jan 1, eff_to NULL)
    b. UPDATE commission_configs SET effective_to = '2026-03-31 23:59:59.999' WHERE id = config_A.id
    c. INSERT commission_configs (user_id=Ali, seller_rate, 0.12, eff_from='2026-04-01', eff_to=NULL)
    d. INSERT activity_logs (actor=owner, action='commission.updated', before={rate:0.10}, after={rate:0.12}, reason="Q2 raise")
  COMMIT

Result:
  Orders created Jan 1 – Mar 31: use snapshot with 10%  ✓
  Orders created Apr 1+: use snapshot with 12%           ✓
  Historical earnings for Ali: unchanged                  ✓
```

---

### 16.4 Compensation Module — Owner CRM UI Structure

```
HR (top-level nav)
├── Сотрудники (Employees)
│     └── [Employee list] → click employee
│           ├── Profile
│           ├── Performance
│           └── Compensation
│                 ├── Current Rates (table: type | rate | since | source)
│                 ├── Rate History (timeline)
│                 └── [+ Set New Rate] button
│
├── Команды (Teams)
│     └── [Team list] → click team
│           ├── Team Info
│           ├── Members
│           └── Compensation
│                 ├── Team-Level Rates (overrides global)
│                 ├── Rate History
│                 └── [+ Set Team Rate] button
│
├── Глобальные ставки (Global Defaults)
│     ├── seller_rate          [current value] [Edit]
│     ├── manager_team_rate    [current value] [Edit]
│     ├── manager_personal_rate [current value] [Edit]
│     ├── team_lead_pool_rate  [current value] [Edit]
│     └── company_rate         [current value] [Edit]
│
├── Тарифы доставки (Delivery Tariffs)
│     ├── [Active Tariff] — name, type, fee/ranges
│     ├── [Tariff History] — all previous tariffs
│     └── [+ Create Tariff] button
│
├── История изменений (Change History)
│     ├── Filter: by employee, team, type, date range, changed by
│     ├── Table: date | who | what changed | old rate | new rate | reason
│     └── Export to Excel
│
└── Анализ влияния (Impact Analysis)
      ├── Select rate config → see which orders used it
      ├── Total commissions paid at that rate
      └── Comparison: if rate had been X instead, delta = Y
```

---

## PART 17: FINANCIAL ENGINE (UPDATED — v2.0)

### Golden Rule
```
FINANCIAL ENGINE READS ONLY FROM order_financial_snapshots.
NEVER FROM commission_configs OR delivery_tariffs AT CALCULATION TIME.
```

### ProcessDelivered(order)

```
FinancialEngine.ProcessDelivered(order Order):
  1. Load snapshot = order_financial_snapshots WHERE order_id = order.id
     — Snapshot guaranteed to exist (created when order was created)

  2. net_revenue = order.net_revenue  (pre-computed at creation)

  3. Determine commissions based on order_type + snapshot rates:

     SELLER_ORDER:
       seller_commission      = net_revenue × snapshot.seller_rate
       manager_team_comm      = net_revenue × snapshot.manager_team_rate
       team_lead_pool         = net_revenue × snapshot.team_lead_pool_rate
       company_revenue        = net_revenue × snapshot.company_rate

     MANAGER_PERSONAL_ORDER:
       seller_commission      = 0
       manager_personal_comm  = net_revenue × snapshot.manager_personal_rate
       manager_team_comm      = net_revenue × snapshot.manager_team_rate
       team_lead_pool         = net_revenue × snapshot.team_lead_pool_rate
       company_revenue        = net_revenue × snapshot.company_rate

     TEAM_LEAD_PERSONAL_ORDER:
       seller_commission      = 0
       manager_personal_comm  = 0
       manager_team_comm      = net_revenue × snapshot.manager_team_rate
       team_lead_pool         = net_revenue × snapshot.team_lead_pool_rate
       company_revenue        = net_revenue × snapshot.company_rate

  4. courier_fee = snapshot.tariff_fee  (pre-resolved at order creation)

  5. team_lead_keeps = team_lead_pool
                       - seller_commission
                       - manager_team_comm
                       - manager_personal_comm

  6. BEGIN TRANSACTION
       INSERT financial_events × 5-6 rows (all with snapshot_id reference)
       UPDATE order.status = 'delivered', delivered_at = now()
     COMMIT
     — If commit fails → full rollback, status NOT changed

  7. Trigger notifications async (outside transaction)
```

---

## PART 8: FINANCIAL MODEL REFERENCE (unchanged)

| Scenario | Courier | Seller | Mgr Team | Mgr Personal | TL Keeps | Company |
|----------|---------|--------|----------|--------------|----------|---------|
| Seller order (net=80, tariff=20) | 20 | 8 (10%) | 2.4 (3%) | — | 29.6 | 48 |
| Manager personal (net=80) | 20 | 0 | 2.4 (3%) | 16 (20%) | 21.6 | 48 |
| TL personal (net=80) | 20 | 0 | 2.4 (3%) | — | 37.6 | 48 |

*All rates from snapshot. TL pool = 40%, Company = 60%. Courier paid from delivery_fee, not net_revenue.*

---

## PART 9: ORDER LIFECYCLE (unchanged from v1.0)

```
NEW
  │ (dispatcher confirms + verifies prepayment)
  ▼
CONFIRMED
  │ (dispatcher assigns courier + schedules)
  ▼
DISPATCHED
  │ (courier picks up)
  ▼
IN_DELIVERY
  │
  ├──→ DELIVERED  → [FinancialEngine.ProcessDelivered()]
  │
  ├──→ RETURNED   → [FinancialEngine.ProcessReturned()] → cancel commissions
  │
  ├──→ ISSUE      → [Dispatcher resolves → back to IN_DELIVERY or RETURNED]
  │
  └──→ CANCELLED  → [FinancialEngine.ProcessCancelled()]
```

**Order creation also triggers:**
- `SnapshotBuilder.BuildAndSave()` — inside same transaction
- If snapshot build fails → order creation fails

---

## PART 10: WAREHOUSE LIFECYCLE (unchanged from v1.0)

```
Product Created → Stock In → Order Created (reserved) →
Order Dispatched (deducted) → Returned (restocked) | Delivered (done)
```

---

## PART 11: COURIER CASH FLOW (unchanged from v1.0)

```
courier_collects = order.total_amount - order.prepayment
courier_keeps    = snapshot.tariff_fee
courier_returns  = courier_collects - courier_keeps
```

---

## PART 12: REPORTING (UPDATED — v2.0)

### Report Types

| Report | Audience | Data Source |
|--------|----------|-------------|
| Order Summary | All (filtered) | orders + order_items |
| Seller Performance | Manager, TL, Owner | financial_events + snapshots |
| Team Revenue | TL, Owner | financial_events GROUP BY team |
| Courier Performance | Dispatcher, Owner | orders + cash_handovers |
| Financial P&L | Owner | financial_events + product costs |
| Inventory Report | Warehouse, Owner | inventory + movements |
| **Current Commission Rates** | Owner | commission_configs (active) |
| **Rate Change History** | Owner | commission_configs + activity_logs |
| **Rate Impact Analysis** | Owner | commission_configs → financial_events |
| Activity Audit | Owner | activity_logs |

### Rate Impact Analysis Query (Pseudocode)
```sql
-- "If seller Ali had 12% instead of 10% since Jan 1, what difference?"
SELECT
  COUNT(*) AS orders_affected,
  SUM(fe.amount) AS actual_commissions_paid,
  SUM(ofs.net_revenue × 0.12) AS hypothetical_commissions,
  SUM(ofs.net_revenue × 0.12) - SUM(fe.amount) AS delta
FROM financial_events fe
JOIN order_financial_snapshots ofs ON ofs.order_id = fe.order_id
WHERE fe.user_id = :ali_id
  AND fe.event_type = 'seller_commission_confirmed'
  AND ofs.seller_config_id = :old_config_id
```

---

## PART 13: ACTIVITY LOG ARCHITECTURE (UPDATED — v2.0)

Every state-changing action logs immutably. Compensation changes require a `reason` field.

**Compensation-specific audit events:**
```
commission.global_rate_updated  { type, old_rate, new_rate, effective_from }
commission.team_rate_updated    { team_id, type, old_rate, new_rate, effective_from }
commission.employee_rate_updated { user_id, type, old_rate, new_rate, effective_from }
commission.rate_disabled        { config_id, effective_to }
tariff.created                  { tariff_id, type, fee/ranges, effective_from }
tariff.deactivated              { tariff_id, effective_to }
```

Activity log writes are **async** (buffered channel → background goroutine batch insert every 5s). Never blocks API response. Compensation changes are the exception — they are logged **synchronously inside the same transaction** as the config change.

---

## PART 14: NOTIFICATION ARCHITECTURE (unchanged from v1.0)

| Event | Recipients | Channels |
|-------|-----------|---------|
| order.created | dispatcher | in-app, ws |
| order.confirmed | seller | in-app, ws |
| order.assigned | courier | push, in-app |
| order.delivered | seller, manager, dispatcher | in-app, ws |
| order.returned | seller, dispatcher | in-app, ws |
| order.issue | dispatcher | in-app, ws, telegram |
| cash_handover.pending | dispatcher | in-app, telegram |
| low_stock | warehouse_manager, owner | in-app, telegram |
| **commission.rate_changed** | affected employee | in-app |

---

## PART 15: DEVELOPMENT ROADMAP (UPDATED — v2.0)

### Phase 1 — Foundation (Weeks 1–3)
- [ ] PostgreSQL schema + migrations (Goose)
- [ ] Go project structure + Gin router
- [ ] Auth module (JWT + refresh)
- [ ] User + hierarchy CRUD
- [ ] RBAC middleware
- [ ] React app skeleton + role-based routing

### Phase 2 — Compensation Module (Weeks 3–5) ← NEW PRIORITY
- [ ] commission_configs table + CRUD API
- [ ] delivery_tariffs table + CRUD API
- [ ] RateResolver service
- [ ] TariffCalculator service
- [ ] SnapshotBuilder service
- [ ] order_financial_snapshots table
- [ ] Owner CRM: HR → Compensation UI (global + team + employee tabs)
- [ ] Owner CRM: Delivery Tariffs UI
- [ ] Rate history view
- [ ] Seed global defaults before any order can be created

### Phase 3 — Core Orders (Weeks 5–8)
- [ ] Full order lifecycle + status machine
- [ ] Financial engine (reads from snapshots)
- [ ] Financial ledger (financial_events)
- [ ] Dispatcher panel
- [ ] Seller panel (orders + earnings)
- [ ] WebSocket real-time updates

### Phase 4 — Courier App (Weeks 9–11)
- [ ] Expo app + auth
- [ ] Order list + status updates
- [ ] Photo proof upload
- [ ] Cash center + handover
- [ ] Push notifications
- [ ] Offline cache (read-only)

### Phase 5 — Analytics & Warehouse (Weeks 12–14)
- [ ] Manager + TL panels
- [ ] Warehouse panel
- [ ] Reporting module
- [ ] Compensation impact reports
- [ ] Excel exports

### Phase 6 — Owner CRM Polish (Weeks 15–17)
- [ ] Owner CRM full visibility
- [ ] HR module (performance)
- [ ] Activity logs viewer
- [ ] Commission rate change history
- [ ] Performance optimization

### Phase 7 — SaaS Preparation (Post-Launch)
- [ ] organization_id on all tables
- [ ] Subscription billing
- [ ] White-label config
- [ ] Multi-language (keys already in place)

---

## QUICK REFERENCE: ALL KEY DECISIONS

| Decision | Choice | Reason |
|----------|--------|--------|
| Financial storage | Event-sourced ledger | Immutable audit, dispute resolution |
| Commission timing | On delivery confirmation | No speculative earnings |
| Rate storage | commission_configs with history | Full audit trail, no mutations |
| Rate resolution | 3-tier: employee > team > global | Flexible per-person configuration |
| Rate snapshot | order_financial_snapshots | Frozen at order creation, guaranteed reproducibility |
| Snapshot timing | Inside order creation transaction | Atomic — no order without snapshot |
| Rate changes | New row + close previous | Immutable history, no updates to old rows |
| Tariff changes | New tariff record | Same immutability principle as rates |
| Activity logs | Async except compensation changes | Compensation changes sync inside same tx |
| Offline courier | Read-only cache V1 | Avoids sync conflicts |
| State machine | Explicit enum + middleware | Prevents illegal transitions |
| i18n | Keys from day 1, Russian only | SaaS-ready without rewrite |
| Read replicas | For analytics queries | Protect write DB |
| Single backend | One Go binary | Correct — avoid distributed complexity |

---

## VALIDATION CHECKLIST

Before going live, verify:
- [ ] Global defaults exist for ALL 5 commission types
- [ ] At least one active tariff exists
- [ ] Rate resolver returns NO_RATE_CONFIGURED → blocks order creation with clear UI error
- [ ] Snapshot created for every order (non-nullable FK enforced at DB level)
- [ ] financial_events always reference a snapshot_id
- [ ] No commission calculation in codebase reads from commission_configs directly
- [ ] Activity log written for every commission_configs INSERT and UPDATE
- [ ] Compensation change UI requires `reason` field (non-empty)

---

*v2.0 — Dynamic Commission & HR Compensation System. Ready for Phase 1 + Phase 2 implementation.*
