-- +goose Up
-- requested_delivery_date is the date the client asked for at order creation time
-- (set by seller/manager/owner/team-lead in the create-order form). It is distinct
-- from scheduled_at, which is the dispatcher's own operational delivery window set
-- later during dispatch/courier scheduling.

ALTER TABLE orders
    ADD COLUMN requested_delivery_date DATE;

CREATE INDEX idx_orders_requested_delivery_date ON orders(requested_delivery_date) WHERE requested_delivery_date IS NOT NULL;

-- +goose Down
ALTER TABLE orders
    DROP COLUMN IF EXISTS requested_delivery_date;
