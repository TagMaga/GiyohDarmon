-- Add per-order delivery address so courier address-changes don't
-- overwrite the shared customer record.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE orders DROP COLUMN IF EXISTS delivery_address;

-- +goose StatementEnd
