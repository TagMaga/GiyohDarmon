-- +goose Up
-- Immutable delivery attempt log per order.
-- attempt_no is auto-computed as the next sequential attempt for that order.

CREATE TYPE delivery_attempt_result AS ENUM (
    'no_answer',
    'busy',
    'rescheduled',
    'wrong_address',
    'customer_cancelled',
    'refused',
    'other'
);

CREATE TABLE delivery_attempts (
    id         UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID                    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id UUID                    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attempt_no INT                     NOT NULL CHECK (attempt_no > 0),
    result     delivery_attempt_result NOT NULL,
    comment    TEXT,
    created_at TIMESTAMPTZ             NOT NULL DEFAULT NOW()
    -- Immutable: no updated_at
);

CREATE INDEX idx_delivery_attempts_order_id   ON delivery_attempts(order_id);
CREATE INDEX idx_delivery_attempts_courier_id ON delivery_attempts(courier_id);

-- +goose Down
DROP TABLE IF EXISTS delivery_attempts;
DROP TYPE  IF EXISTS delivery_attempt_result;
