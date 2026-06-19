-- +goose Up
-- +goose StatementBegin

CREATE TABLE writeoffs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    product_id   UUID NOT NULL REFERENCES products  (id) ON DELETE RESTRICT,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    reason       TEXT NOT NULL,
    approved_by  UUID REFERENCES users (id) ON DELETE SET NULL,
    created_by   UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_writeoffs_warehouse_id ON writeoffs (warehouse_id);
CREATE INDEX idx_writeoffs_product_id   ON writeoffs (product_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS writeoffs;
-- +goose StatementEnd
