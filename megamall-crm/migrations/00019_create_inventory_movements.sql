-- +goose Up
-- +goose StatementBegin

CREATE TABLE inventory_movements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    product_id        UUID NOT NULL REFERENCES products  (id) ON DELETE RESTRICT,
    movement_type     inventory_movement_type NOT NULL,
    -- quantity is always positive; direction is implied by movement_type
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
    new_quantity      INTEGER NOT NULL CHECK (new_quantity >= 0),
    reason            TEXT,
    -- links the two movements of a transfer pair (transfer_in ↔ transfer_out)
    reference_id      UUID,
    created_by        UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_movements_warehouse  ON inventory_movements (warehouse_id, created_at DESC);
CREATE INDEX idx_inv_movements_product    ON inventory_movements (product_id,   created_at DESC);
CREATE INDEX idx_inv_movements_type       ON inventory_movements (movement_type, created_at DESC);
CREATE INDEX idx_inv_movements_reference  ON inventory_movements (reference_id)
    WHERE reference_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS inventory_movements;
-- +goose StatementEnd
