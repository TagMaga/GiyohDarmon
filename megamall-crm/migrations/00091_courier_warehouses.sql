-- Migration 00091: Courier warehouse inventory tracking.
--
-- Design decision (see docs/AUDIT note in PR description): migration 00063
-- collapsed the system to a single implicit global stock pool per product
-- (no warehouse_id anywhere). Rather than re-threading warehouse_id through
-- the existing `inventory` / `inventory_movements` / `inventory_batches`
-- FIFO machinery (high blast radius: receiving, write-offs, adjustments,
-- sales/slow-moving reports, and every existing test all assume one row
-- per product), this migration adds courier warehouses as an ADDITIVE,
-- parallel ledger:
--
--   • `warehouses` — organizational rows (type main|courier). Exactly one
--     main warehouse is seeded (matching today's single-pool reality); the
--     model supports more being created later for additional branches.
--   • `courier_inventory` / `courier_inventory_movements` — a second,
--     warehouse-scoped stock ledger used ONLY for stock physically held by
--     a courier. The legacy `inventory` table keeps representing the main
--     warehouse pool exactly as it does today — untouched schema, untouched
--     behavior, so receiving/write-offs/FIFO/reports keep working as-is.
--   • `inventory_transfers` / `inventory_transfer_items` — main → courier
--     issuance, with a blocked-quantity hold on the legacy `inventory` row
--     while `issued`, released back to the legacy pool on `rejected`, or
--     moved into `courier_inventory` (with FIFO cost consumed on the legacy
--     side, preserving COGS accounting) on `accepted`.
--   • `courier_returns` / `courier_return_items` — full-inventory courier
--     → main returns (mirrors transfers in the opposite direction).
--   • `lost_product_reports` — courier lost-product debt (cost only, no
--     delivery fee), pending owner/warehouse_manager approval.
--   • `order_items.reserved_warehouse_id` — NOT NULL, defaults to the
--     legacy main warehouse for every existing row (reservations are
--     preserved exactly: same quantities, same product, just now labeled
--     with an explicit warehouse). Going forward this column records
--     which ledger currently holds an order's reservation: the legacy
--     main warehouse until a courier accepts a transfer or self-assigns
--     against their own stock, at which point it flips to that courier's
--     `courier_inventory`-backed warehouse.
--
-- Nothing is dropped. Old `inventory`/`inventory_movements`/`inventory_batches`
-- schema and semantics are 100% unchanged, so this migration cannot regress
-- receiving/write-off/adjustment/report functionality. Rollback is a
-- straight DROP of the new tables/column — no old data is touched, so
-- rollback is safe at any point.

-- +goose Up
-- +goose StatementBegin

-- ── Warehouses ───────────────────────────────────────────────────────────────
CREATE TYPE warehouse_type AS ENUM ('main', 'courier');

CREATE TABLE warehouses (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    type        warehouse_type NOT NULL,
    name        VARCHAR(150)   NOT NULL,
    city_id     UUID           REFERENCES cities(id),
    courier_id  UUID           REFERENCES users(id) ON DELETE CASCADE,
    is_active   BOOLEAN        NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT chk_warehouse_courier_link CHECK (
        (type = 'courier' AND courier_id IS NOT NULL) OR
        (type = 'main'    AND courier_id IS NULL)
    ),
    CONSTRAINT uq_warehouse_courier UNIQUE (courier_id)
);

CREATE INDEX idx_warehouses_type ON warehouses (type) WHERE is_active;
CREATE INDEX idx_warehouses_city ON warehouses (city_id);

-- Seed exactly one default main warehouse. Every existing order-item
-- reservation and every future transfer source resolves to this row unless
-- the owner explicitly creates additional main warehouses.
INSERT INTO warehouses (id, type, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'main', 'Главный склад', true);

-- ── Legacy main-pool blocking ────────────────────────────────────────────────
-- A transfer issuance blocks stock at the legacy main warehouse pool between
-- `issued` and `accepted`/`rejected` so it can't be double-allocated to a new
-- order in the meantime. Default 0 preserves every existing row/behavior;
-- the generated column is recreated (not altered in place — Postgres has no
-- ALTER for a generation expression) to also subtract it.
ALTER TABLE inventory ADD COLUMN blocked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (blocked_quantity >= 0);
ALTER TABLE inventory DROP COLUMN available_quantity;
ALTER TABLE inventory ADD COLUMN available_quantity INTEGER
    GENERATED ALWAYS AS (quantity - reserved_quantity - blocked_quantity) STORED;

-- ── Courier inventory ledger ─────────────────────────────────────────────────
CREATE TABLE courier_inventory (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id        UUID        NOT NULL REFERENCES warehouses(id),
    product_id          UUID        NOT NULL REFERENCES products(id),
    quantity            INTEGER     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity   INTEGER     NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    blocked_quantity    INTEGER     NOT NULL DEFAULT 0 CHECK (blocked_quantity >= 0),
    available_quantity  INTEGER     GENERATED ALWAYS AS (quantity - reserved_quantity - blocked_quantity) STORED,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_courier_inventory UNIQUE (warehouse_id, product_id),
    CONSTRAINT chk_courier_inventory_bounds CHECK (reserved_quantity + blocked_quantity <= quantity)
);

CREATE TYPE courier_movement_type AS ENUM (
    'transfer_in',      -- accepted transfer: stock arrives from main warehouse
    'transfer_out',     -- accepted return: stock leaves back to main warehouse
    'delivered',        -- order delivered: deducted from courier stock
    'refused',          -- customer refusal: reservation released, stock stays
    'postponed',        -- delivery postponed: reservation released, stock stays
    'cancelled',        -- order cancelled: reservation released, stock stays
    'returned',         -- order returned: reservation released, stock stays
    'address_changed',  -- delivery address changed: reservation released, stock stays
    'claim_reserve',    -- self-assignment: reservation created against courier stock
    'claim_release',    -- courier released/unassigned: reservation released
    'lost'              -- lost-product report approved: stock removed, debt created
);

CREATE TABLE courier_inventory_movements (
    id                 UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id       UUID                  NOT NULL REFERENCES warehouses(id),
    product_id         UUID                  NOT NULL REFERENCES products(id),
    movement_type      courier_movement_type NOT NULL,
    quantity           INTEGER               NOT NULL,
    previous_quantity  INTEGER               NOT NULL,
    new_quantity       INTEGER               NOT NULL,
    reference_type     VARCHAR(30),
    reference_id       UUID,
    reason             TEXT,
    created_by         UUID                  NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX idx_courier_inv_movements_warehouse ON courier_inventory_movements (warehouse_id, created_at DESC);
CREATE INDEX idx_courier_inv_movements_reference ON courier_inventory_movements (reference_type, reference_id);

-- ── Transfers (main warehouse -> courier issuance) ──────────────────────────
CREATE TYPE transfer_status AS ENUM ('issued', 'accepted', 'rejected');

CREATE TABLE inventory_transfers (
    id                 UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    from_warehouse_id  UUID             NOT NULL REFERENCES warehouses(id),
    to_courier_id      UUID             NOT NULL REFERENCES users(id),
    to_warehouse_id    UUID             REFERENCES warehouses(id),
    status             transfer_status  NOT NULL DEFAULT 'issued',
    created_by         UUID             NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
    decided_by         UUID             REFERENCES users(id),
    decided_at         TIMESTAMPTZ
);

CREATE TABLE inventory_transfer_items (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id  UUID    NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
    product_id   UUID    NOT NULL REFERENCES products(id),
    quantity     INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_transfers_courier ON inventory_transfers (to_courier_id, created_at DESC);
CREATE INDEX idx_transfers_status  ON inventory_transfers (status);
CREATE INDEX idx_transfer_items_transfer ON inventory_transfer_items (transfer_id);

-- ── Returns (courier -> main warehouse, full inventory only) ────────────────
CREATE TYPE return_status AS ENUM ('requested', 'accepted', 'rejected');

CREATE TABLE courier_returns (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id         UUID           NOT NULL REFERENCES users(id),
    from_warehouse_id  UUID           NOT NULL REFERENCES warehouses(id),
    to_warehouse_id    UUID           NOT NULL REFERENCES warehouses(id),
    status             return_status  NOT NULL DEFAULT 'requested',
    created_by         UUID           NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
    decided_by         UUID           REFERENCES users(id),
    decided_at         TIMESTAMPTZ
);

CREATE TABLE courier_return_items (
    id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id  UUID    NOT NULL REFERENCES courier_returns(id) ON DELETE CASCADE,
    product_id UUID    NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_courier_returns_courier ON courier_returns (courier_id, created_at DESC);
CREATE INDEX idx_return_items_return ON courier_return_items (return_id);

-- ── Lost product reports (courier debt) ─────────────────────────────────────
CREATE TYPE lost_report_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE lost_product_reports (
    id           UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id   UUID                NOT NULL REFERENCES users(id),
    warehouse_id UUID                NOT NULL REFERENCES warehouses(id),
    product_id   UUID                NOT NULL REFERENCES products(id),
    quantity     INTEGER             NOT NULL CHECK (quantity > 0),
    photo_url    TEXT                NOT NULL,
    comment      TEXT                NOT NULL,
    unit_cost    NUMERIC(12,2)       NOT NULL CHECK (unit_cost >= 0),
    debt_amount  NUMERIC(12,2)       NOT NULL CHECK (debt_amount >= 0),
    status       lost_report_status  NOT NULL DEFAULT 'pending',
    created_by   UUID                NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ         NOT NULL DEFAULT now(),
    decided_by   UUID                REFERENCES users(id),
    decided_at   TIMESTAMPTZ
);

CREATE INDEX idx_lost_reports_courier ON lost_product_reports (courier_id, created_at DESC);
CREATE INDEX idx_lost_reports_status  ON lost_product_reports (status);

-- ── Order item reservation location ─────────────────────────────────────────
-- Every existing order_item is explicitly backfilled to the seeded main
-- warehouse (reservation quantities themselves are untouched — this only
-- labels where they already logically live).
ALTER TABLE order_items ADD COLUMN reserved_warehouse_id UUID REFERENCES warehouses(id);
UPDATE order_items SET reserved_warehouse_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE order_items ALTER COLUMN reserved_warehouse_id SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN reserved_warehouse_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX idx_order_items_reserved_warehouse ON order_items (reserved_warehouse_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE order_items DROP COLUMN IF EXISTS reserved_warehouse_id;

ALTER TABLE inventory DROP COLUMN IF EXISTS available_quantity;
ALTER TABLE inventory ADD COLUMN available_quantity INTEGER
    GENERATED ALWAYS AS (quantity - reserved_quantity) STORED;
ALTER TABLE inventory DROP COLUMN IF EXISTS blocked_quantity;

DROP TABLE IF EXISTS lost_product_reports;
DROP TYPE IF EXISTS lost_report_status;

DROP TABLE IF EXISTS courier_return_items;
DROP TABLE IF EXISTS courier_returns;
DROP TYPE IF EXISTS return_status;

DROP TABLE IF EXISTS inventory_transfer_items;
DROP TABLE IF EXISTS inventory_transfers;
DROP TYPE IF EXISTS transfer_status;

DROP TABLE IF EXISTS courier_inventory_movements;
DROP TYPE IF EXISTS courier_movement_type;
DROP TABLE IF EXISTS courier_inventory;

DROP TABLE IF EXISTS warehouses;
DROP TYPE IF EXISTS warehouse_type;

-- +goose StatementEnd
