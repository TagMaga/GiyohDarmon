-- +goose Up
-- +goose StatementBegin

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS courier_order_intake_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS courier_order_intake_reason TEXT,
    ADD COLUMN IF NOT EXISTS courier_order_intake_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS courier_order_intake_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_courier_order_intake
    ON users (courier_order_intake_enabled)
    WHERE role = 'courier' AND deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_users_courier_order_intake;

ALTER TABLE users
    DROP COLUMN IF EXISTS courier_order_intake_updated_by,
    DROP COLUMN IF EXISTS courier_order_intake_updated_at,
    DROP COLUMN IF EXISTS courier_order_intake_reason,
    DROP COLUMN IF EXISTS courier_order_intake_enabled;

-- +goose StatementEnd
