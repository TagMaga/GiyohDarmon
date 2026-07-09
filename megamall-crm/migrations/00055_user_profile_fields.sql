-- migration 00055: add status, hire_date, date_of_birth, address to users

-- +goose Up
-- +goose StatementBegin

-- 1. Create the status enum
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM (
        'online', 'away', 'offline', 'vacation', 'sick', 'terminated'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add new columns (all nullable / with defaults so existing rows stay valid)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS status        user_status NOT NULL DEFAULT 'offline',
    ADD COLUMN IF NOT EXISTS hire_date     DATE,
    ADD COLUMN IF NOT EXISTS date_of_birth DATE,
    ADD COLUMN IF NOT EXISTS address       TEXT;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE users
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS hire_date,
    DROP COLUMN IF EXISTS date_of_birth,
    DROP COLUMN IF EXISTS address;

DROP TYPE IF EXISTS user_status;

-- +goose StatementEnd
