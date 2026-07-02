-- +goose Up
CREATE TABLE inventory_receiving_edits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_id     UUID NOT NULL REFERENCES inventory_movements(id) ON DELETE CASCADE,
    edited_by       UUID NOT NULL REFERENCES users(id),
    old_product_id  UUID NOT NULL REFERENCES products(id),
    new_product_id  UUID NOT NULL REFERENCES products(id),
    old_quantity    INTEGER NOT NULL,
    new_quantity    INTEGER NOT NULL,
    old_unit_cost   NUMERIC(12,2) NOT NULL,
    new_unit_cost   NUMERIC(12,2) NOT NULL,
    old_note        TEXT NOT NULL DEFAULT '',
    new_note        TEXT NOT NULL DEFAULT '',
    edited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_receiving_edits_movement
    ON inventory_receiving_edits (movement_id, edited_at DESC);

-- +goose Down
DROP TABLE IF EXISTS inventory_receiving_edits;
