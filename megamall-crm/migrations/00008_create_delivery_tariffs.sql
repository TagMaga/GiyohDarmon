-- +goose Up
-- +goose StatementBegin

CREATE TYPE tariff_type AS ENUM ('fixed', 'tiered');

-- Delivery tariff header.
--
-- IMMUTABILITY RULES (same as commission_configs):
--   Changes create a new tariff record; old records are closed (effective_to set).
--   Never update fee, type, or ranges on an existing record.
--
-- At any point in time, at most one tariff should have is_active = true AND effective_to IS NULL.
-- This is enforced by the partial unique index below.
CREATE TABLE delivery_tariffs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    type           tariff_type  NOT NULL,
    fixed_fee      NUMERIC(12,2)
                   CONSTRAINT chk_tariff_fixed_fee CHECK (fixed_fee IS NULL OR fixed_fee > 0),
    is_active      BOOLEAN      NOT NULL DEFAULT true,
    effective_from TIMESTAMPTZ  NOT NULL,
    effective_to   TIMESTAMPTZ,               -- NULL = currently open / active
    notes          TEXT         NOT NULL,     -- reason this tariff was created
    created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    -- NO updated_at. NO deleted_at.
);

-- Only one active tariff at a time.
-- Trick: index on a constant expression so the WHERE clause makes it unique-per-one-row.
CREATE UNIQUE INDEX uq_active_tariff
    ON delivery_tariffs ((1))
    WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX idx_delivery_tariffs_timeline
    ON delivery_tariffs (effective_from, effective_to);

-- Tiered delivery ranges.
-- Only populated when the parent tariff has type = 'tiered'.
-- Ranges must not overlap (validated in application layer).
CREATE TABLE delivery_tariff_ranges (
    id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id  UUID          NOT NULL REFERENCES delivery_tariffs(id) ON DELETE CASCADE,
    min_amount NUMERIC(12,2) NOT NULL
               CONSTRAINT chk_range_min_non_negative CHECK (min_amount >= 0),
    max_amount NUMERIC(12,2)
               CONSTRAINT chk_range_max_gt_min CHECK (max_amount IS NULL OR max_amount > min_amount),
    fee        NUMERIC(12,2) NOT NULL
               CONSTRAINT chk_range_fee_positive CHECK (fee > 0),
    sort_order INT           NOT NULL DEFAULT 0
);

CREATE INDEX idx_tariff_ranges_by_tariff ON delivery_tariff_ranges (tariff_id, sort_order ASC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS delivery_tariff_ranges;
DROP TABLE IF EXISTS delivery_tariffs;
DROP TYPE  IF EXISTS tariff_type;
-- +goose StatementEnd
