-- +goose Up
-- Generalized payout ledger: replaces seller-only seller_payouts so a Team Lead
-- can pay a Manager and a Manager can pay a Seller through the same table shape.
-- seller_payouts has never had a create endpoint (rows were never written through
-- the app) and holds 0 rows in production, so it is safe to drop outright.
DROP TABLE IF EXISTS seller_payouts;

CREATE TABLE payouts (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    payee_id        UUID            NOT NULL REFERENCES users(id),
    payee_role      user_role       NOT NULL,
    payer_id        UUID            NOT NULL REFERENCES users(id),
    payer_role      user_role       NOT NULL,
    amount          NUMERIC(12, 2)  NOT NULL CHECK (amount > 0),
    period_start    DATE            NOT NULL,
    period_end      DATE            NOT NULL,
    method          VARCHAR(50),                       -- "cash" | "bank_transfer" | "card"
    status          VARCHAR(20)     NOT NULL DEFAULT 'paid',   -- "paid" | "pending"
    note            TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT payouts_period_check CHECK (period_end >= period_start)
);

CREATE INDEX idx_payouts_payee            ON payouts(payee_id, payee_role);
CREATE INDEX idx_payouts_payer            ON payouts(payer_id);
CREATE INDEX idx_payouts_period           ON payouts(period_start, period_end);
CREATE INDEX idx_payouts_payer_role_date  ON payouts(payer_role, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS payouts;
