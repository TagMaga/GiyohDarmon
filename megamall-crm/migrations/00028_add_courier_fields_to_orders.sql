-- +goose Up
-- Add courier cache fields to orders table.
-- courier_id is a query-optimisation cache; the authoritative source is order_assignments (is_active=true).
-- scheduled_at is the dispatcher-set delivery window.

ALTER TABLE orders
    ADD COLUMN courier_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN scheduled_at TIMESTAMPTZ;

CREATE INDEX idx_orders_courier_id  ON orders(courier_id) WHERE courier_id IS NOT NULL;
CREATE INDEX idx_orders_scheduled_at ON orders(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- +goose Down
ALTER TABLE orders
    DROP COLUMN IF EXISTS courier_id,
    DROP COLUMN IF EXISTS scheduled_at;
