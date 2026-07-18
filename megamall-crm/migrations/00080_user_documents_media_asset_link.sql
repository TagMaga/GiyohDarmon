-- +goose Up
-- +goose StatementBegin

-- Links user_documents (HR/passport-class documents) to the centralized
-- media pipeline (media_assets, migration 00075) without touching file_url
-- — pure addition, fully backward compatible. A NULL media_asset_id means
-- file_url is a legacy value (the client uploaded via the generic
-- /uploads endpoint first, then POSTed the resulting URL here); a
-- non-NULL one means the document was uploaded through internal/media
-- (category user_document, private visibility, owner-only RBAC — see
-- internal/media/rbac.go's CategoryUserDocument entry).
--
-- Note: content_type/size_bytes/original_filename already exist on this
-- table (migration 00067) for its own purposes and are left untouched;
-- once media_asset_id is set, new rows source those three fields from the
-- media asset's own recorded metadata rather than trusting client-supplied
-- values, but the columns themselves are unchanged.
--
-- ON DELETE SET NULL: if the media asset is ever hard-deleted by the
-- retention-purge job, the document row survives with a stale file_url
-- rather than being affected in any other way.
--
-- Deliberately NO preview_url column — a private-category signed URL
-- expires after 15 minutes (MediaConfig.SignedURLTTL), so persisting one
-- would go stale almost immediately. internal/users mints a fresh signed
-- URL on every read (see internal/users/mediabridge's SignedURLFn) and
-- returns it as file_url in the API response, falling back to the stored
-- legacy column only when media_asset_id is NULL. Documents are never
-- rasterized/converted (PDFs stay PDFs — see ProcessPrivateProofPreview's
-- image-only gate), so width/height are nullable and typically unset for
-- non-image documents.
ALTER TABLE user_documents
    ADD COLUMN media_asset_id UUID REFERENCES media_assets (id) ON DELETE SET NULL,
    ADD COLUMN width INTEGER,
    ADD COLUMN height INTEGER;

CREATE INDEX idx_user_documents_media_asset_id
    ON user_documents (media_asset_id)
    WHERE media_asset_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_documents_media_asset_id;
ALTER TABLE user_documents
    DROP COLUMN IF EXISTS media_asset_id,
    DROP COLUMN IF EXISTS width,
    DROP COLUMN IF EXISTS height;
-- +goose StatementEnd
