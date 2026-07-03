-- +goose Up
-- Idempotency: one batch row per bulk "Выплатить" submission, keyed by
-- (payer_id, idempotency_key). A retried/duplicated request finds the same
-- batch row (unique violation) and the service replays the original result
-- instead of inserting a second set of payouts.
CREATE TABLE payout_batches (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id        UUID         NOT NULL REFERENCES users(id),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (payer_id, idempotency_key)
);

-- Reversal, not deletion: a wrong payout is voided (status flag + audit
-- fields), never removed — keeps the ledger append-only and auditable.
ALTER TABLE payouts ADD COLUMN batch_id    UUID REFERENCES payout_batches(id);
ALTER TABLE payouts ADD COLUMN voided_at   TIMESTAMPTZ;
ALTER TABLE payouts ADD COLUMN voided_by   UUID REFERENCES users(id);
ALTER TABLE payouts ADD COLUMN void_reason TEXT;

CREATE INDEX idx_payout_batches_payer ON payout_batches(payer_id);
CREATE INDEX idx_payouts_batch_id     ON payouts(batch_id);

-- +goose Down
ALTER TABLE payouts DROP COLUMN IF EXISTS void_reason;
ALTER TABLE payouts DROP COLUMN IF EXISTS voided_by;
ALTER TABLE payouts DROP COLUMN IF EXISTS voided_at;
ALTER TABLE payouts DROP COLUMN IF EXISTS batch_id;
DROP TABLE IF EXISTS payout_batches;
