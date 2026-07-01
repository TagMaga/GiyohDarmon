-- +goose Up
-- Shared, polymorphic edit-audit trail for finance business expenses and budget
-- transactions (top-ups / owner withdrawals). Only amount and note are ever
-- editable on either subject, so no category diff column is needed.
CREATE TABLE record_edits (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type TEXT        NOT NULL CHECK (subject_type IN ('finance_expense', 'budget_transaction')),
    subject_id   UUID        NOT NULL,
    edited_by    UUID        NOT NULL REFERENCES users(id),
    old_amount   NUMERIC(14,2) NOT NULL,
    new_amount   NUMERIC(14,2) NOT NULL,
    old_note     TEXT        NOT NULL DEFAULT '',
    new_note     TEXT        NOT NULL DEFAULT '',
    edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_record_edits_subject ON record_edits (subject_type, subject_id, edited_at DESC);

-- +goose Down
DROP TABLE IF EXISTS record_edits;
