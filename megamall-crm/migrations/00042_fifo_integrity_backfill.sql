-- +goose Up
-- +goose StatementBegin

CREATE INDEX IF NOT EXISTS idx_inv_batches_fifo_active
    ON inventory_batches (warehouse_id, product_id, received_at ASC)
    WHERE remaining_quantity > 0;

-- Backfill inventory rows that have positive stock but no equivalent FIFO
-- remaining quantity. This covers databases where 00041 skipped soft-deleted
-- products or seed/test data created inventory rows without batches.
INSERT INTO inventory_batches (
    id, warehouse_id, product_id,
    received_quantity, remaining_quantity,
    unit_cost, received_at, movement_id, created_by
)
SELECT
    gen_random_uuid(),
    i.warehouse_id,
    i.product_id,
    (i.quantity - COALESCE(b.batch_quantity, 0))::int,
    (i.quantity - COALESCE(b.batch_quantity, 0))::int,
    COALESCE(p.purchase_price, 0),
    NOW() - INTERVAL '1 second',
    NULL,
    NULL
FROM inventory i
LEFT JOIN products p ON p.id = i.product_id
LEFT JOIN (
    SELECT warehouse_id, product_id, SUM(remaining_quantity) AS batch_quantity
    FROM inventory_batches
    GROUP BY warehouse_id, product_id
) b ON b.warehouse_id = i.warehouse_id AND b.product_id = i.product_id
WHERE i.quantity > COALESCE(b.batch_quantity, 0);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_inv_batches_fifo_active;

-- +goose StatementEnd
