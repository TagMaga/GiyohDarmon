-- +goose Up
-- Edit history for cash handovers: every owner-side decision (confirm /
-- reject) and every post-decision correction ("edit") is recorded as an
-- append-only row with the old and new values. Handovers themselves stay
-- mutable via the owner logistics edit endpoint; this table is the audit
-- trail that makes those corrections safe.
CREATE TABLE cash_handover_edits (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    handover_id         UUID            NOT NULL REFERENCES cash_handovers(id) ON DELETE CASCADE,
    editor_id           UUID            REFERENCES users(id) ON DELETE SET NULL,
    action              TEXT            NOT NULL CHECK (action IN ('confirm', 'reject', 'update', 'edit')),
    old_status          handover_status,
    new_status          handover_status,
    old_actual_returned NUMERIC(12,2),
    new_actual_returned NUMERIC(12,2),
    old_admin_note      TEXT,
    new_admin_note      TEXT,
    old_comment         TEXT,
    new_comment         TEXT,
    reason              TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_handover_edits_handover ON cash_handover_edits(handover_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS cash_handover_edits;
