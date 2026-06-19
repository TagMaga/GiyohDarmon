-- +goose Up
-- +goose StatementBegin

CREATE TYPE rate_source AS ENUM ('employee', 'team', 'global');

-- Immutable snapshot of all resolved rates, frozen at order creation time.
--
-- GOLDEN RULE: The Financial Engine reads ONLY from this table during calculations.
--              It NEVER reads from commission_configs or delivery_tariffs at calc time.
--
-- Created once per order inside the order creation transaction.
-- If snapshot creation fails, the order creation fails — they are atomic.
--
-- NOTE: order_id FK to orders.id is intentionally omitted here.
--       The orders table does not exist until Phase 4.
--       Phase 4 migration will add: ALTER TABLE order_financial_snapshots
--         ADD CONSTRAINT fk_snapshot_order FOREIGN KEY (order_id) REFERENCES orders(id).
CREATE TABLE order_financial_snapshots (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                    UUID         UNIQUE,     -- FK to orders.id added in Phase 4

    -- Five frozen commission rates (resolved at order.created_at)
    seller_rate                 NUMERIC(6,5) NOT NULL,
    manager_team_rate           NUMERIC(6,5) NOT NULL,
    manager_personal_rate       NUMERIC(6,5) NOT NULL,
    team_lead_pool_rate         NUMERIC(6,5) NOT NULL,
    company_rate                NUMERIC(6,5) NOT NULL,

    -- Resolved delivery tariff
    tariff_id                   UUID         REFERENCES delivery_tariffs(id),
    tariff_type                 tariff_type  NOT NULL,
    tariff_fee                  NUMERIC(12,2) NOT NULL,

    -- Rate source tracing: which scope was used for each rate
    seller_rate_source              rate_source NOT NULL,
    manager_team_rate_source        rate_source NOT NULL,
    manager_personal_rate_source    rate_source NOT NULL,
    team_lead_pool_rate_source      rate_source NOT NULL,
    company_rate_source             rate_source NOT NULL,

    -- Config ID references for full audit traceability
    seller_config_id            UUID REFERENCES commission_configs(id),
    manager_team_config_id      UUID REFERENCES commission_configs(id),
    manager_personal_config_id  UUID REFERENCES commission_configs(id),
    team_lead_pool_config_id    UUID REFERENCES commission_configs(id),
    company_config_id           UUID REFERENCES commission_configs(id),

    -- Full denormalized JSON (human-readable backup, includes all inputs)
    snapshot_json               JSONB        NOT NULL,

    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    -- NO updated_at. This row is NEVER modified after creation.
);

CREATE INDEX idx_snapshots_order_id   ON order_financial_snapshots (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_snapshots_tariff_id  ON order_financial_snapshots (tariff_id) WHERE tariff_id IS NOT NULL;
CREATE INDEX idx_snapshots_created_at ON order_financial_snapshots (created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS order_financial_snapshots;
DROP TYPE  IF EXISTS rate_source;
-- +goose StatementEnd
