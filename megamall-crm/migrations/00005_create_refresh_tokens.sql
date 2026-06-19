-- +goose Up
-- +goose StatementBegin

-- Refresh tokens use a token family model.
-- Reuse of a revoked token in a family revokes ALL tokens in that family.
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 hash of the raw token — never store raw tokens.
    token_hash  VARCHAR(64) NOT NULL,
    -- Family groups all rotations of a single login session.
    family_id   UUID        NOT NULL,
    device_info VARCHAR(255),
    ip_address  INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_refresh_tokens_hash    ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user_id       ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family_id     ON refresh_tokens (family_id);
CREATE INDEX idx_refresh_tokens_expires_at    ON refresh_tokens (expires_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS refresh_tokens;
-- +goose StatementEnd
