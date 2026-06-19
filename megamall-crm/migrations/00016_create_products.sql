-- +goose Up
-- +goose StatementBegin

CREATE TYPE inventory_movement_type AS ENUM (
    'purchase',
    'sale',
    'return',
    'transfer_in',
    'transfer_out',
    'adjustment',
    'writeoff'
);

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku             VARCHAR(100) NOT NULL,
    article_number  VARCHAR(100),
    barcode         VARCHAR(100),
    name            VARCHAR(500) NOT NULL,
    description     TEXT,
    category_id     UUID REFERENCES categories (id) ON DELETE SET NULL,
    supplier_id     UUID REFERENCES suppliers (id) ON DELETE SET NULL,
    purchase_price  NUMERIC(12, 2),
    sale_price      NUMERIC(12, 2),
    weight          NUMERIC(10, 3),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Partial unique indexes respect soft-delete: only enforce uniqueness on live rows.
CREATE UNIQUE INDEX idx_products_sku     ON products (sku)     WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_products_barcode ON products (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

CREATE INDEX idx_products_category_id ON products (category_id);
CREATE INDEX idx_products_supplier_id ON products (supplier_id);
CREATE INDEX idx_products_deleted_at  ON products (deleted_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS products;
DROP TYPE IF EXISTS inventory_movement_type;
-- +goose StatementEnd
