-- +goose Up
-- +goose StatementBegin

-- The delivery_tariffs / delivery_tariff_ranges system (migration 00008) was
-- superseded by delivery_settings (migration 00047) as the single source of
-- truth for delivery fees. Since then delivery_tariffs.fixed_fee was never
-- consulted for the actual charged fee (only used to stamp audit metadata
-- on order_financial_snapshots) — it drifted out of sync with the real fee
-- and only confused owners editing "Настройки доставки" who assumed it was
-- the same setting. Removing the dead system entirely.

-- order_financial_snapshots.tariff_fee already holds the real, authoritative
-- delivery fee (sourced from delivery_settings / product overrides at order
-- creation) — rename it to reflect that, and drop the now-meaningless
-- tariff_id / tariff_type columns.
ALTER TABLE order_financial_snapshots DROP COLUMN tariff_id;
ALTER TABLE order_financial_snapshots DROP COLUMN tariff_type;
ALTER TABLE order_financial_snapshots RENAME COLUMN tariff_fee TO delivery_fee;

DROP TABLE delivery_tariff_ranges;
DROP TABLE delivery_tariffs;
DROP TYPE tariff_type;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

CREATE TYPE tariff_type AS ENUM ('fixed', 'tiered');

CREATE TABLE delivery_tariffs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    type           tariff_type  NOT NULL,
    fixed_fee      NUMERIC(12,2)
                   CONSTRAINT chk_tariff_fixed_fee CHECK (fixed_fee IS NULL OR fixed_fee > 0),
    is_active      BOOLEAN      NOT NULL DEFAULT true,
    effective_from TIMESTAMPTZ  NOT NULL,
    effective_to   TIMESTAMPTZ,
    notes          TEXT         NOT NULL,
    created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_active_tariff
    ON delivery_tariffs ((1))
    WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX idx_delivery_tariffs_timeline
    ON delivery_tariffs (effective_from, effective_to);

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

ALTER TABLE order_financial_snapshots RENAME COLUMN delivery_fee TO tariff_fee;
ALTER TABLE order_financial_snapshots ADD COLUMN tariff_id UUID REFERENCES delivery_tariffs(id);
ALTER TABLE order_financial_snapshots ADD COLUMN tariff_type tariff_type NOT NULL DEFAULT 'fixed';
ALTER TABLE order_financial_snapshots ALTER COLUMN tariff_type DROP DEFAULT;

CREATE INDEX idx_snapshots_tariff_id ON order_financial_snapshots (tariff_id) WHERE tariff_id IS NOT NULL;

-- +goose StatementEnd
