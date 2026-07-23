-- +goose Up
-- +goose StatementBegin

-- Job-title/position display field, distinct from `role` (which is the
-- permission enum used for RBAC). Nullable/free-text: not every user has a
-- formal title, and this is presentation-only — no code should branch on
-- its value.
ALTER TABLE users ADD COLUMN position VARCHAR(255);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN IF EXISTS position;
-- +goose StatementEnd
