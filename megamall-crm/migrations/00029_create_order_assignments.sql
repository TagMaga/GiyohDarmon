-- +goose Up
-- order_assignments tracks courier assignment history for each order.
-- is_active=true row is the authoritative source of truth for who is currently
-- responsible for delivering the order.
-- CONSTRAINT: at most one is_active=true row per order enforced via partial unique index.

CREATE TABLE order_assignments (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id     UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by    UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unassigned_at  TIMESTAMPTZ,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    note           TEXT
);

-- Enforces: only one active assignment per order at a time.
CREATE UNIQUE INDEX uq_order_assignments_active
    ON order_assignments(order_id)
    WHERE is_active = TRUE;

CREATE INDEX idx_order_assignments_order_id   ON order_assignments(order_id);
CREATE INDEX idx_order_assignments_courier_id ON order_assignments(courier_id);
CREATE INDEX idx_order_assignments_active     ON order_assignments(courier_id) WHERE is_active = TRUE;

-- +goose Down
DROP TABLE IF EXISTS order_assignments;
