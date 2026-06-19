-- +goose Up
CREATE TABLE IF NOT EXISTS courier_push_tokens (
    user_id   UUID        NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token     TEXT        NOT NULL,
    platform  VARCHAR(16) NOT NULL DEFAULT 'unknown',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS courier_push_tokens;
