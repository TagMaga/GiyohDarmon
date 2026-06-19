-- +goose Up
-- +goose StatementBegin

-- Phase 2 left the FK to orders as a TODO because the orders table
-- did not exist yet. Now that orders exists (migration 00023), we add
-- the FK constraint and back-fill the snapshot_id FK on orders.

ALTER TABLE order_financial_snapshots
    ADD CONSTRAINT fk_snapshot_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;

ALTER TABLE orders
    ADD CONSTRAINT fk_orders_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES order_financial_snapshots (id) ON DELETE SET NULL;

ALTER TABLE financial_events
    ADD CONSTRAINT fk_financial_events_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE financial_events          DROP CONSTRAINT IF EXISTS fk_financial_events_order;
ALTER TABLE orders                    DROP CONSTRAINT IF EXISTS fk_orders_snapshot;
ALTER TABLE order_financial_snapshots DROP CONSTRAINT IF EXISTS fk_snapshot_order;
-- +goose StatementEnd
