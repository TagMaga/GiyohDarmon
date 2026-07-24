-- +goose Up
-- +goose StatementBegin

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS courier_max_active_orders INT;

ALTER TABLE users
    ADD CONSTRAINT chk_courier_max_active_orders_positive
    CHECK (courier_max_active_orders IS NULL OR courier_max_active_orders > 0);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_courier_max_active_orders_positive;

ALTER TABLE users
    DROP COLUMN IF EXISTS courier_max_active_orders;

-- +goose StatementEnd
