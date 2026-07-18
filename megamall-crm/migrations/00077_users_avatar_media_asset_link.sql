-- +goose Up
-- +goose StatementBegin

-- Links users.avatar_url to the centralized media pipeline (media_assets,
-- migration 00075) without touching avatar_url itself — pure addition,
-- fully backward compatible. A NULL avatar_media_asset_id means the row's
-- avatar_url is a legacy value (set directly by the old POST /users/me
-- /avatar | /users/:id/avatar handlers, which save to ./uploads/avatars/
-- and are served unauthenticated); a non-NULL one means the avatar was
-- uploaded through internal/media (category avatar, private visibility).
--
-- ON DELETE SET NULL, not CASCADE/RESTRICT: if the media asset is ever
-- hard-deleted by the retention-purge job, the user row survives and just
-- reverts to a stale avatar_url rather than being affected in any other way.
--
-- Deliberately NO avatar_preview_url column: unlike product_images'
-- public, permanently-stable thumbnail/card/detail URLs (migration 00076),
-- a private-category signed URL expires after MediaConfig.SignedURLTTL
-- (15 min) — persisting one here would either go stale almost
-- immediately or, if kept "fresh" by some background job, defeat the
-- point of short-lived signatures entirely. Instead, internal/users
-- mints a fresh signed URL on every read (see internal/users/mediabridge's
-- SignedURLFn) and returns it as avatar_url in the API response, falling
-- back to the stored legacy column only when avatar_media_asset_id is
-- NULL. avatar_width/avatar_height are dimensions, not URLs, so they are
-- safe to denormalize permanently.
ALTER TABLE users
    ADD COLUMN avatar_media_asset_id UUID REFERENCES media_assets (id) ON DELETE SET NULL,
    ADD COLUMN avatar_width INTEGER,
    ADD COLUMN avatar_height INTEGER;

CREATE INDEX idx_users_avatar_media_asset_id
    ON users (avatar_media_asset_id)
    WHERE avatar_media_asset_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_users_avatar_media_asset_id;
ALTER TABLE users
    DROP COLUMN IF EXISTS avatar_media_asset_id,
    DROP COLUMN IF EXISTS avatar_width,
    DROP COLUMN IF EXISTS avatar_height;
-- +goose StatementEnd
