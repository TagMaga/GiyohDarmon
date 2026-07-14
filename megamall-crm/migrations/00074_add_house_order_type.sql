-- +goose NO TRANSACTION
-- +goose Up
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- 'house_order' is for orders the owner creates directly with no seller/team
-- attribution — no seller/manager/team-lead commission is paid on them, only
-- company revenue (enforced in compensation.ApplyCommissionRules).
ALTER TYPE order_type ADD VALUE IF NOT EXISTS 'house_order';

-- +goose Down
-- Postgres cannot drop enum values; this migration is irreversible by design.
