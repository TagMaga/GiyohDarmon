-- +goose Up
-- +goose StatementBegin

-- Links order_attachments to the centralized media pipeline (media_assets,
-- migration 00075) without touching file_url — pure addition, fully
-- backward compatible. A NULL media_asset_id means file_url is a legacy
-- value (the client uploaded via the generic /uploads endpoint first, then
-- POSTed the resulting URL here); a non-NULL one means the attachment was
-- created through internal/media (category order_attachment, private
-- visibility).
--
-- ON DELETE SET NULL: if the media asset is ever hard-deleted by the
-- retention-purge job, the attachment row survives with a stale file_url
-- rather than being affected in any other way.
--
-- Deliberately NO preview_url column — a private-category signed URL
-- expires after 15 minutes (MediaConfig.SignedURLTTL), so persisting one
-- would go stale almost immediately. internal/orders mints a fresh signed
-- URL on every read (see internal/orders/mediabridge's SignedURLFn) and
-- returns it as file_url in the API response, falling back to the stored
-- legacy column only when media_asset_id is NULL. width/height are
-- dimensions, not URLs, so they are safe to denormalize permanently.
ALTER TABLE order_attachments
    ADD COLUMN media_asset_id UUID REFERENCES media_assets (id) ON DELETE SET NULL,
    ADD COLUMN width INTEGER,
    ADD COLUMN height INTEGER;

CREATE INDEX idx_order_attachments_media_asset_id
    ON order_attachments (media_asset_id)
    WHERE media_asset_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_order_attachments_media_asset_id;
ALTER TABLE order_attachments
    DROP COLUMN IF EXISTS media_asset_id,
    DROP COLUMN IF EXISTS width,
    DROP COLUMN IF EXISTS height;
-- +goose StatementEnd
