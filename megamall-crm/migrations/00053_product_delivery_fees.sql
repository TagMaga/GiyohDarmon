-- +goose Up
-- Per-product delivery fees for seller order creation.
-- Both columns are nullable; NULL means "use global delivery_settings".
ALTER TABLE products
    ADD COLUMN normal_delivery_fee  NUMERIC(12, 2),
    ADD COLUMN express_delivery_fee NUMERIC(12, 2);

-- +goose Down
ALTER TABLE products
    DROP COLUMN IF EXISTS normal_delivery_fee,
    DROP COLUMN IF EXISTS express_delivery_fee;
