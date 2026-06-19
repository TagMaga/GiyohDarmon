-- +goose Up
-- +goose StatementBegin

CREATE TYPE order_type AS ENUM (
    'seller_order',
    'manager_personal_order',
    'team_lead_personal_order'
);

CREATE TYPE order_status AS ENUM (
    'new',
    'confirmed',
    'prepayment_pending',
    'prepayment_received',
    'assigned',
    'in_delivery',
    'delivered',
    'returned',
    'cancelled',
    'issue'
);

-- Human-readable order numbering sequence.
CREATE SEQUENCE order_number_seq START 1000;

CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(20) NOT NULL DEFAULT ('ORD-' || LPAD(nextval('order_number_seq')::TEXT, 4, '0')),

    customer_id         UUID NOT NULL REFERENCES customers  (id) ON DELETE RESTRICT,
    -- seller_id is always the creating user regardless of order_type.
    seller_id           UUID NOT NULL REFERENCES users      (id) ON DELETE RESTRICT,

    -- Hierarchy snapshot frozen at order creation. Never recalculated.
    manager_id          UUID         REFERENCES users  (id) ON DELETE SET NULL,
    team_lead_id        UUID         REFERENCES users  (id) ON DELETE SET NULL,
    manager_team_id     UUID         REFERENCES teams  (id) ON DELETE SET NULL,
    team_lead_team_id   UUID         REFERENCES teams  (id) ON DELETE SET NULL,

    order_type          order_type   NOT NULL,
    status              order_status NOT NULL DEFAULT 'new',
    warehouse_id        UUID NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,

    -- Financial snapshot (FK added in migration 00027 after orders table exists).
    snapshot_id         UUID UNIQUE,

    -- Financials (all set at order creation; corrections applied per spec).
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_fee        NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- total_amount = subtotal (customer-facing price; delivery_fee is deducted FROM it).
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- net_revenue = total_amount - delivery_fee (base for all commission calculations).
    net_revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
    prepayment_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,

    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT orders_order_number_unique UNIQUE (order_number)
);

CREATE INDEX idx_orders_customer_id   ON orders (customer_id);
CREATE INDEX idx_orders_seller_id     ON orders (seller_id);
CREATE INDEX idx_orders_manager_id    ON orders (manager_id);
CREATE INDEX idx_orders_team_lead_id  ON orders (team_lead_id);
CREATE INDEX idx_orders_status        ON orders (status);
CREATE INDEX idx_orders_order_type    ON orders (order_type);
CREATE INDEX idx_orders_warehouse_id  ON orders (warehouse_id);
CREATE INDEX idx_orders_created_at    ON orders (created_at DESC);
CREATE INDEX idx_orders_deleted_at    ON orders (deleted_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS orders;
DROP SEQUENCE IF EXISTS order_number_seq;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS order_type;
-- +goose StatementEnd
