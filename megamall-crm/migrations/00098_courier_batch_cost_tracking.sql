-- 00098_courier_batch_cost_tracking.sql
-- Fixes product-cost tracking for courier-delivered orders. Previously, cost
-- (FIFO/FEFO batch consumption) was only recorded against orders fulfilled
-- straight from the main warehouse (movement_type='sale' tied to order.id).
-- Orders fulfilled via a courier warehouse never got a cost record: the FIFO
-- consumption at transfer-accept time was tied to the transfer, not the
-- order, and courier_inventory tracked quantity only, no cost.
--
-- This adds a courier-side batch ledger — mirroring inventory_batches /
-- inventory_batch_consumptions — so cost lots created at transfer-accept
-- time (in the exact per-накладная unit cost and FIFO order they were
-- consumed from the main warehouse) can be FIFO-consumed again when an
-- order is later delivered from that courier's stock. orders.product_cost
-- becomes the single authoritative per-order cost, written once at delivery
-- from either path, and is what internal/finance now reads directly instead
-- of re-deriving it from inventory_movements.

-- +goose Up
-- +goose StatementBegin

-- Cost lots held by a courier warehouse. One row per batch consumed on the
-- courier's behalf when a transfer is accepted (source_batch_id/transfer_id
-- kept for audit/traceability; not required for FIFO consumption itself,
-- which orders strictly by created_at).
CREATE TABLE courier_inventory_batches (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id         UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    source_batch_id    UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
    transfer_id        UUID REFERENCES inventory_transfers(id) ON DELETE SET NULL,
    received_quantity  INT NOT NULL,
    remaining_quantity INT NOT NULL,
    unit_cost          NUMERIC(12,2) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FIFO scan: active lots for (warehouse, product), oldest first.
CREATE INDEX idx_courier_inv_batches_fifo_active
    ON courier_inventory_batches (warehouse_id, product_id, created_at ASC)
    WHERE remaining_quantity > 0;

-- Records exactly which courier lot(s), at which unit cost, were consumed by
-- a given courier_inventory_movements row (the "delivered" movement).
CREATE TABLE courier_batch_consumptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    UUID NOT NULL REFERENCES courier_inventory_batches(id) ON DELETE RESTRICT,
    movement_id UUID NOT NULL REFERENCES courier_inventory_movements(id) ON DELETE RESTRICT,
    quantity    INT NOT NULL,
    unit_cost   NUMERIC(12,2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_courier_batch_consumptions_movement
    ON courier_batch_consumptions (movement_id);

-- Authoritative per-order product cost, written once at delivery (both the
-- main-warehouse and courier-warehouse fulfilment paths). Default 0 for
-- historical rows — cost data for orders delivered before this migration
-- cannot be reconstructed (see repository.go comment).
ALTER TABLE orders
    ADD COLUMN product_cost NUMERIC(12,2) NOT NULL DEFAULT 0;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE orders DROP COLUMN IF EXISTS product_cost;

DROP INDEX IF EXISTS idx_courier_batch_consumptions_movement;
DROP TABLE IF EXISTS courier_batch_consumptions;

DROP INDEX IF EXISTS idx_courier_inv_batches_fifo_active;
DROP TABLE IF EXISTS courier_inventory_batches;

-- +goose StatementEnd
