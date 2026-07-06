-- +goose Up
ALTER TABLE user_documents
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'uploaded';

-- +goose Down
ALTER TABLE user_documents
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS document_type;
