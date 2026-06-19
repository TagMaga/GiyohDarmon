-- +goose Up
-- +goose StatementBegin

CREATE TABLE inventory (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id        UUID NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    product_id          UUID NOT NULL REFERENCES products  (id) ON DELETE RESTRICT,
    quantity            INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    -- generated column: always quantity - reserved_quantity
    available_quantity  INTEGER GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT inventory_unique_warehouse_product UNIQUE (warehouse_id, product_id),
    -- ensures available_quantity is never negative at the DB level
    CONSTRAINT inventory_available_nonnegative    CHECK (quantity >= reserved_quantity)
);

CREATE INDEX idx_inventory_warehouse_id ON inventory (warehouse_id);
CREATE INDEX idx_inventory_product_id   ON inventory (product_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS inventory;
-- +goose StatementEnd
