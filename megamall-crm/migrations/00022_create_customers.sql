-- +goose Up
-- +goose StatementBegin

CREATE TYPE customer_source AS ENUM (
    'instagram',
    'facebook',
    'tiktok',
    'website',
    'phone',
    'referral',
    'marketplace',
    'other'
);

CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(20)  NOT NULL,
    phone_secondary VARCHAR(20),
    city            VARCHAR(100),
    region          VARCHAR(100),
    address         TEXT,
    notes           TEXT,
    source          customer_source,
    created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Duplicate phones are allowed (business rule), but indexed for fast lookup.
CREATE INDEX idx_customers_phone      ON customers (phone);
CREATE INDEX idx_customers_deleted_at ON customers (deleted_at);
CREATE INDEX idx_customers_created_by ON customers (created_by);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS customers;
DROP TYPE  IF EXISTS customer_source;
-- +goose StatementEnd
