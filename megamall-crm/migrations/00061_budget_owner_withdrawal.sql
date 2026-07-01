-- +goose NO TRANSACTION
-- +goose Up
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
ALTER TYPE budget_transaction_type ADD VALUE IF NOT EXISTS 'owner_withdrawal';

-- +goose Down
-- Postgres cannot drop enum values; this migration is irreversible by design.
