-- +goose Up
-- +goose StatementBegin

CREATE TABLE order_prepayments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    proof_url   TEXT,
    verified_by UUID REFERENCES users (id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_by  UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_prepayments_order_id ON order_prepayments (order_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS order_prepayments;
-- +goose StatementEnd
