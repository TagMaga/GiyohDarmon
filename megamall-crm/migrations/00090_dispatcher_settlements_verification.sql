-- +goose Up
-- Verification fields for dispatcher_settlements (owner enters the actually
-- received amount on confirm, mirroring cash_handovers' expected/actual
-- pattern) plus its append-only edit-history audit trail, mirroring
-- cash_handover_edits (see 00082_cash_handover_edits.sql). Proof photos are
-- NOT a column here, same as cash_handovers has no proof column of its own:
-- they're media_assets rows found via owner_entity_type='dispatcher_settlements'.
ALTER TABLE dispatcher_settlements
    ADD COLUMN actual_received NUMERIC(12,2) CHECK (actual_received >= 0),
    ADD COLUMN admin_note      TEXT;

CREATE TABLE dispatcher_settlement_edits (
    id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_id         UUID              NOT NULL REFERENCES dispatcher_settlements(id) ON DELETE CASCADE,
    editor_id             UUID              REFERENCES users(id) ON DELETE SET NULL,
    action                TEXT              NOT NULL CHECK (action IN ('confirm', 'reject', 'edit')),
    old_status            settlement_status,
    new_status            settlement_status,
    old_actual_received   NUMERIC(12,2),
    new_actual_received   NUMERIC(12,2),
    old_admin_note        TEXT,
    new_admin_note        TEXT,
    reason                TEXT,
    created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispatcher_settlement_edits_settlement ON dispatcher_settlement_edits(settlement_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS dispatcher_settlement_edits;
ALTER TABLE dispatcher_settlements
    DROP COLUMN IF EXISTS actual_received,
    DROP COLUMN IF EXISTS admin_note;
