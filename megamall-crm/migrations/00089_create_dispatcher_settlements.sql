-- +goose Up
-- Dispatcher-to-company cash settlements: a dispatcher periodically remits
-- the cash they've collected from couriers (via cash_handovers) to the
-- company. Each submission is reviewed by the owner (confirm/reject), mirroring
-- the cash_handovers courier->dispatcher review flow one level up.
CREATE TYPE settlement_status AS ENUM (
    'pending',
    'confirmed',
    'rejected'
);

CREATE TABLE dispatcher_settlements (
    id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatcher_id   UUID              NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount          NUMERIC(12,2)     NOT NULL CHECK (amount >= 0),
    status          settlement_status NOT NULL DEFAULT 'pending',
    comment         TEXT,
    rejection_reason TEXT,
    reviewed_by     UUID              REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispatcher_settlements_dispatcher_id ON dispatcher_settlements(dispatcher_id);
CREATE INDEX idx_dispatcher_settlements_status        ON dispatcher_settlements(status);

-- +goose Down
DROP TABLE IF EXISTS dispatcher_settlements;
DROP TYPE  IF EXISTS settlement_status;
