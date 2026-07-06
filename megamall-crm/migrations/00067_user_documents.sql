-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS user_documents (
    id                UUID PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_url          TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    content_type      TEXT,
    size_bytes        BIGINT,
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_documents_user_id_created
    ON user_documents (user_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS user_documents;

-- +goose StatementEnd
