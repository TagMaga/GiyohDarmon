-- +goose Up
-- +goose StatementBegin

-- The business only ever operates one physical warehouse and one product
-- category. Both concepts add UI/API surface with no real function and are
-- removed here in favor of an implicit single location/catalog.

-- ── Consolidate inventory across warehouses before collapsing to a
--    single-location model (defensive: dev/prod data is already
--    single-warehouse in practice, but this makes the migration safe even
--    if stray rows exist in another warehouse). ──
WITH consolidated AS (
    SELECT product_id,
           SUM(quantity)            AS quantity,
           SUM(reserved_quantity)   AS reserved_quantity,
           MAX(low_stock_threshold) AS low_stock_threshold
    FROM inventory
    GROUP BY product_id
),
keep AS (
    SELECT DISTINCT ON (product_id) id, product_id
    FROM inventory
    ORDER BY product_id, created_at ASC
)
UPDATE inventory i
SET quantity             = c.quantity,
    reserved_quantity    = c.reserved_quantity,
    low_stock_threshold  = c.low_stock_threshold
FROM consolidated c, keep k
WHERE i.id = k.id AND k.product_id = c.product_id;

DELETE FROM inventory i
USING keep k
WHERE i.product_id = k.product_id AND i.id <> k.id;

-- ── inventory: drop warehouse scoping, rekey uniqueness to product_id ──
ALTER TABLE inventory DROP CONSTRAINT inventory_unique_warehouse_product;
DROP INDEX IF EXISTS idx_inventory_warehouse_id;
ALTER TABLE inventory DROP COLUMN warehouse_id;
ALTER TABLE inventory ADD CONSTRAINT inventory_unique_product UNIQUE (product_id);

-- ── inventory_batches: rekey FIFO indexes to product_id ──
DROP INDEX IF EXISTS idx_inv_batches_fifo;
DROP INDEX IF EXISTS idx_inv_batches_fifo_active;
ALTER TABLE inventory_batches DROP COLUMN warehouse_id;
CREATE INDEX idx_inv_batches_fifo ON inventory_batches (product_id, received_at ASC);
CREATE INDEX idx_inv_batches_fifo_active ON inventory_batches (product_id, received_at ASC)
    WHERE remaining_quantity > 0;

-- ── inventory_movements: drop warehouse scoping (product_id index already covers reads) ──
DROP INDEX IF EXISTS idx_inv_movements_warehouse;
ALTER TABLE inventory_movements DROP COLUMN warehouse_id;

-- ── writeoffs: drop warehouse scoping ──
DROP INDEX IF EXISTS idx_writeoffs_warehouse_id;
ALTER TABLE writeoffs DROP COLUMN warehouse_id;

-- ── inventory_adjustments: drop warehouse scoping ──
DROP INDEX IF EXISTS idx_inv_adjustments_warehouse;
ALTER TABLE inventory_adjustments DROP COLUMN warehouse_id;

-- ── orders: drop warehouse requirement ──
DROP INDEX IF EXISTS idx_orders_warehouse_id;
ALTER TABLE orders DROP COLUMN warehouse_id;

-- ── warehouses entity no longer needed ──
DROP TABLE IF EXISTS warehouses;

-- ── products: drop category ──
DROP INDEX IF EXISTS idx_products_category_id;
ALTER TABLE products DROP COLUMN category_id;

-- ── categories entity no longer needed ──
DROP TABLE IF EXISTS categories;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Best-effort schema restore. Data provenance across multiple
-- warehouses/categories cannot be reconstructed since the Up migration
-- consolidates everything into a single implicit location/catalog.

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID REFERENCES categories (id) ON DELETE SET NULL,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_categories_parent_id ON categories (parent_id);

ALTER TABLE products ADD COLUMN category_id UUID REFERENCES categories (id) ON DELETE SET NULL;
CREATE INDEX idx_products_category_id ON products (category_id);

CREATE TABLE warehouses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(255) NOT NULL,
    address    TEXT,
    notes      TEXT,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO warehouses (name) VALUES ('Main Warehouse');

ALTER TABLE orders ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE orders SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE orders ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_orders_warehouse_id ON orders (warehouse_id);

ALTER TABLE inventory_adjustments ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE inventory_adjustments SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE inventory_adjustments ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_inv_adjustments_warehouse ON inventory_adjustments (warehouse_id);

ALTER TABLE writeoffs ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE writeoffs SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE writeoffs ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_writeoffs_warehouse_id ON writeoffs (warehouse_id);

ALTER TABLE inventory_movements ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE inventory_movements SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE inventory_movements ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_inv_movements_warehouse ON inventory_movements (warehouse_id, created_at DESC);

DROP INDEX IF EXISTS idx_inv_batches_fifo;
DROP INDEX IF EXISTS idx_inv_batches_fifo_active;
ALTER TABLE inventory_batches ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE inventory_batches SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE inventory_batches ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_inv_batches_fifo ON inventory_batches (warehouse_id, product_id, received_at ASC);
CREATE INDEX idx_inv_batches_fifo_active ON inventory_batches (warehouse_id, product_id, received_at ASC)
    WHERE remaining_quantity > 0;

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_unique_product;
ALTER TABLE inventory ADD COLUMN warehouse_id UUID REFERENCES warehouses (id) ON DELETE RESTRICT;
UPDATE inventory SET warehouse_id = (SELECT id FROM warehouses LIMIT 1);
ALTER TABLE inventory ALTER COLUMN warehouse_id SET NOT NULL;
CREATE INDEX idx_inventory_warehouse_id ON inventory (warehouse_id);
ALTER TABLE inventory ADD CONSTRAINT inventory_unique_warehouse_product UNIQUE (warehouse_id, product_id);

-- +goose StatementEnd
