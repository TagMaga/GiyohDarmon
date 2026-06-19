-- +goose Up
-- Supplementary status-history table for logistics analytics.
-- Captures courier_id and role at the time of change, which order_timeline omits.
-- Written in parallel to order_timeline whenever order status changes.

CREATE TABLE IF NOT EXISTS order_status_history (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id          UUID                 REFERENCES users(id)  ON DELETE SET NULL,
    from_status         TEXT,
    to_status           TEXT        NOT NULL,
    changed_by_user_id  UUID                 REFERENCES users(id)  ON DELETE SET NULL,
    changed_by_role     TEXT,
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_osh_order_id   ON order_status_history(order_id);
CREATE INDEX idx_osh_courier_id ON order_status_history(courier_id) WHERE courier_id IS NOT NULL;
CREATE INDEX idx_osh_created_at ON order_status_history(created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS order_status_history;
