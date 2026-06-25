-- +goose Up
-- Seller payout records: when owner/manager pays out a seller's earned commission.
CREATE TABLE seller_payouts (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id       UUID            NOT NULL REFERENCES users(id),
    amount          NUMERIC(12, 2)  NOT NULL CHECK (amount > 0),
    period_start    DATE            NOT NULL,
    period_end      DATE            NOT NULL,
    method          VARCHAR(50),                       -- "bank_transfer" | "cash" | "card" | other
    status          VARCHAR(20)     NOT NULL DEFAULT 'paid',   -- "paid" | "pending"
    paid_by_user_id UUID            REFERENCES users(id),
    paid_at         TIMESTAMPTZ,
    note            TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT seller_payouts_period_check CHECK (period_end >= period_start)
);

CREATE INDEX idx_seller_payouts_seller_id ON seller_payouts(seller_id);
CREATE INDEX idx_seller_payouts_period    ON seller_payouts(period_start, period_end);

-- +goose Down
DROP TABLE IF EXISTS seller_payouts;
