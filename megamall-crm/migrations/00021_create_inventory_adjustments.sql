-- +goose Up
-- +goose StatementBegin

CREATE TABLE inventory_adjustments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    product_id        UUID NOT NULL REFERENCES products  (id) ON DELETE RESTRICT,
    previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
    new_quantity      INTEGER NOT NULL CHECK (new_quantity >= 0),
    reason            TEXT NOT NULL,
    created_by        UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_adjustments_warehouse ON inventory_adjustments (warehouse_id);
CREATE INDEX idx_inv_adjustments_product   ON inventory_adjustments (product_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS inventory_adjustments;
-- +goose StatementEnd
