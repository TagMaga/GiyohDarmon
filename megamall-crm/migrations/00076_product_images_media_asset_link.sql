-- +goose Up
-- +goose StatementBegin

-- Links product_images rows to the centralized media pipeline
-- (media_assets, migration 00075) without touching the legacy image_url
-- column at all — pure addition, fully backward compatible. A NULL
-- media_asset_id means the row is a legacy, directly-set image_url (the
-- pre-Phase-2 flow, e.g. a URL pasted in during CSV import); a non-NULL
-- one means the row was created through internal/media, and image_url is
-- still populated (with the "card" variant's public URL) purely so any
-- existing API consumer reading only image_url keeps working unmodified.
--
-- ON DELETE SET NULL (not CASCADE, not RESTRICT): if a media_assets row is
-- ever hard-deleted by the retention-purge job, the product_images row
-- itself must survive — it just reverts to looking like a legacy row with
-- a now-stale image_url (the product listing still renders something)
-- rather than being silently removed from the product.
--
-- thumbnail_url/card_url/detail_url/width/height are denormalized from the
-- media asset's variant metadata at attach time, not looked up live: public
-- variant URLs are stable and content/version-based (see internal/media's
-- VariantStorageKey — the same key never refers to different bytes), so
-- caching them here is safe and avoids an internal/media lookup (or N+1
-- lookups across a whole product list) on every product read. A replaced
-- image always attaches a new media asset and creates/overwrites this row
-- with fresh values rather than mutating a variant URL in place.
ALTER TABLE product_images
    ADD COLUMN media_asset_id UUID REFERENCES media_assets (id) ON DELETE SET NULL,
    ADD COLUMN thumbnail_url TEXT,
    ADD COLUMN card_url TEXT,
    ADD COLUMN detail_url TEXT,
    ADD COLUMN width INTEGER,
    ADD COLUMN height INTEGER;

CREATE INDEX idx_product_images_media_asset_id
    ON product_images (media_asset_id)
    WHERE media_asset_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_product_images_media_asset_id;
ALTER TABLE product_images
    DROP COLUMN IF EXISTS media_asset_id,
    DROP COLUMN IF EXISTS thumbnail_url,
    DROP COLUMN IF EXISTS card_url,
    DROP COLUMN IF EXISTS detail_url,
    DROP COLUMN IF EXISTS width,
    DROP COLUMN IF EXISTS height;
-- +goose StatementEnd
