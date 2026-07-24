-- +goose Up
-- +goose StatementBegin

-- Documents (passport, etc.) an applicant attaches at giyohdarmon.tj/new.
-- Always uploaded through the centralized media pipeline (category
-- user_document, private visibility, owner-only RBAC — see
-- internal/media/rbac.go's CategoryUserDocument entry) — HR/passport-class
-- documents must never go through the legacy public /uploads endpoint (see
-- the 2026-07-16 P0 incident referenced in TeamDirectoryPage.jsx's
-- DocumentsField). The asset is created unattached (same as the normal
-- upload-then-attach flow every authenticated client uses) and only
-- attached to a real users row on approval (internal/onboarding.
-- Service.Approve calls users.Service.CreateDocument, which performs the
-- attach) — see internal/onboarding/service.go.
--
-- media_asset_id nullable + ON DELETE SET NULL mirrors migration 00080's
-- link from user_documents to media_assets exactly, for the same reason:
-- if the retention-purge job ever hard-deletes the media_assets row, this
-- row survives rather than being affected in any other way.
CREATE TABLE worker_application_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id    UUID NOT NULL REFERENCES worker_applications (id) ON DELETE CASCADE,
    media_asset_id    UUID REFERENCES media_assets (id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type      VARCHAR(120),
    size_bytes        BIGINT,
    document_type     VARCHAR(80) NOT NULL DEFAULT 'other',
    width             INTEGER,
    height            INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worker_application_documents_application_id
    ON worker_application_documents (application_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS worker_application_documents;
-- +goose StatementEnd
