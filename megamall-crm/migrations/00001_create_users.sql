-- +goose Up
-- +goose StatementBegin

-- Required for gen_random_uuid() on PostgreSQL < 13.
-- On PostgreSQL 13+ gen_random_uuid() is built-in, but this is safe to run on all versions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM (
    'owner',
    'sales_team_lead',
    'manager',
    'seller',
    'dispatcher',
    'warehouse_manager',
    'courier'
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         VARCHAR(20)  NOT NULL,
    email         VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    role          user_role    NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    avatar_url    VARCHAR(500),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);

-- Unique constraints only on non-deleted rows
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;

-- Query indexes
CREATE INDEX idx_users_role        ON users (role)       WHERE deleted_at IS NULL;
CREATE INDEX idx_users_is_active   ON users (is_active)  WHERE deleted_at IS NULL;
CREATE INDEX idx_users_deleted_at  ON users (deleted_at) WHERE deleted_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS user_role;
-- +goose StatementEnd
