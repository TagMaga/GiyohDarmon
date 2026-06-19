-- +goose Up
-- +goose StatementBegin

CREATE TYPE financial_event_type AS ENUM (
    'seller_commission_earned',
    'seller_commission_confirmed',
    'seller_commission_cancelled',
    'manager_team_commission_earned',
    'manager_team_commission_confirmed',
    'manager_personal_commission_earned',
    'manager_personal_commission_confirmed',
    'team_lead_pool_earned',
    'team_lead_pool_confirmed',
    'courier_fee_earned',
    'courier_fee_confirmed',
    'company_revenue_earned',
    'company_revenue_confirmed',
    'cash_collected',
    'cash_handed_over'
);

-- Immutable financial ledger.
-- Every commission/payment event appends a row — nothing is ever updated or deleted.
-- Written by the Financial Engine (Phase 4) when order status changes.
--
-- COMMISSION RULES BY ORDER TYPE (enforced by Financial Engine, NOT the snapshot):
--   seller_order:
--     seller_rate, manager_team_rate, team_lead_pool_rate, company_rate apply.
--   manager_personal_order:
--     manager_personal_rate, team_lead_pool_rate, company_rate apply.
--     manager_team_rate = 0 (manager cannot double-pay himself on his own order).
--   team_lead_personal_order:
--     manager_team_rate, team_lead_pool_rate, company_rate apply.
--
-- NOTE: order_id FK to orders.id is intentionally omitted here (Phase 4 adds it).
CREATE TABLE financial_events (
    id          UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID,                            -- FK to orders.id added in Phase 4
    snapshot_id UUID                 REFERENCES order_financial_snapshots(id),
    event_type  financial_event_type NOT NULL,
    user_id     UUID                 REFERENCES users(id) ON DELETE SET NULL,
    amount      NUMERIC(12,2)        NOT NULL,
    metadata    JSONB,               -- calculation steps, rates used, notes
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW()
    -- Immutable — no updated_at.
);

CREATE INDEX idx_fin_events_order_id    ON financial_events (order_id)                              WHERE order_id    IS NOT NULL;
CREATE INDEX idx_fin_events_snapshot_id ON financial_events (snapshot_id)                           WHERE snapshot_id IS NOT NULL;
CREATE INDEX idx_fin_events_user_id     ON financial_events (user_id, event_type, created_at DESC)  WHERE user_id     IS NOT NULL;
CREATE INDEX idx_fin_events_type_date   ON financial_events (event_type, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS financial_events;
DROP TYPE  IF EXISTS financial_event_type;
-- +goose StatementEnd
