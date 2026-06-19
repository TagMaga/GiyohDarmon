-- +goose Up
-- Add admin_note (rejection reason / owner note) and attachments_json (multiple
-- proof file URLs as a JSON array) to cash_handovers.
-- Also adds requested_at as an alias timestamp populated on creation.

ALTER TABLE cash_handovers
    ADD COLUMN IF NOT EXISTS admin_note        TEXT,
    ADD COLUMN IF NOT EXISTS attachments_json  TEXT;

-- +goose Down
ALTER TABLE cash_handovers
    DROP COLUMN IF EXISTS admin_note,
    DROP COLUMN IF EXISTS attachments_json;
