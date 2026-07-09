-- +goose NO TRANSACTION
-- +goose Up
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- 'it_specialist' has full owner-level access, enforced in code via
-- pkg/rbac.IsOwnerLevel — tracked as its own role for audit purposes
-- rather than reusing 'owner' directly.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'it_specialist';

-- +goose Down
-- Postgres cannot drop enum values; this migration is irreversible by design.
