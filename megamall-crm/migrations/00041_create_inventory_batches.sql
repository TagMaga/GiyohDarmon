-- +goose Up
-- +goose StatementBegin

-- FIFO batch tracking: one row per goods receipt (lot/batch).
-- remaining_quantity decreases as stock is consumed FIFO.
CREATE TABLE inventory_batches (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id         UUID NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
    received_quantity  INTEGER      NOT NULL CHECK (received_quantity > 0),
    remaining_quantity INTEGER      NOT NULL CHECK (remaining_quantity >= 0),
    unit_cost          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    movement_id        UUID REFERENCES inventory_movements(id) ON DELETE SET NULL,
    created_by         UUID REFERENCES users(id)               ON DELETE SET NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary FIFO scan: (warehouse, product) ordered by age.
CREATE INDEX idx_inv_batches_fifo
    ON inventory_batches (warehouse_id, product_id, received_at ASC);

CREATE INDEX idx_inv_batches_fifo_active
    ON inventory_batches (warehouse_id, product_id, received_at ASC)
    WHERE remaining_quantity > 0;

-- For looking up batches by movement that created them.
CREATE INDEX idx_inv_batches_movement ON inventory_batches (movement_id);

-- Audit table: records which batch units were consumed by which movement.
CREATE TABLE inventory_batch_consumptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    UUID NOT NULL REFERENCES inventory_batches(id)       ON DELETE RESTRICT,
    movement_id UUID NOT NULL REFERENCES inventory_movements(id)     ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_batch_consumptions_batch    ON inventory_batch_consumptions (batch_id);
CREATE INDEX idx_inv_batch_consumptions_movement ON inventory_batch_consumptions (movement_id);

-- Seed initial batches from existing stock so FIFO works immediately after migration.
-- One batch per (warehouse, product) using current quantity and product purchase_price.
-- received_at is set 1 second in the past so all future receipts are clearly newer.
INSERT INTO inventory_batches (
    id, warehouse_id, product_id,
    received_quantity, remaining_quantity,
    unit_cost, received_at, movement_id, created_by
)
SELECT
    gen_random_uuid(),
    i.warehouse_id,
    i.product_id,
    i.quantity,
    i.quantity,
    COALESCE(p.purchase_price, 0),
    NOW() - INTERVAL '1 second',
    NULL,
    NULL
FROM inventory i
LEFT JOIN products p ON p.id = i.product_id
WHERE i.quantity > 0;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS inventory_batch_consumptions;
DROP TABLE IF EXISTS inventory_batches;
-- +goose StatementEnd
