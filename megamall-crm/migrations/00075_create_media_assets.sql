-- +goose Up
-- +goose StatementBegin

-- Centralized upload metadata for the secure image/document pipeline. Pure
-- addition — no existing table is touched, so this migration is fully
-- reversible (drop table = complete revert, see Down below) and every
-- existing upload code path keeps working unmodified until it's migrated
-- to write through this table.
--
-- storage_key is a server-generated random identifier (never the client's
-- filename — see internal/media.NewStorageKey), used both as the on-disk
-- filename and as the identifier embedded in signed URLs. original_filename
-- is stored only for display/audit purposes and must never be used to build
-- a filesystem path.
CREATE TYPE media_visibility AS ENUM ('public', 'private');

CREATE TYPE media_category AS ENUM (
    'product_image',
    'avatar',
    'order_attachment',
    'prepayment_proof',
    'user_document',
    'cash_handover_proof'
);

CREATE TYPE media_processing_status AS ENUM (
    'pending',
    'processing',
    'ready',
    'failed'
);

CREATE TABLE media_assets (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    storage_key          TEXT NOT NULL UNIQUE,
    original_filename     TEXT NOT NULL,
    detected_mime_type    TEXT NOT NULL,
    original_size_bytes   BIGINT NOT NULL,
    width                 INTEGER,
    height                INTEGER,
    checksum_sha256       TEXT NOT NULL,

    visibility            media_visibility NOT NULL,
    category              media_category NOT NULL,

    -- Polymorphic owning business object (e.g. 'orders'/<order id>,
    -- 'products'/<product id>). Intentionally not a foreign key: the owner
    -- can be any one of several tables, and rows here may briefly exist
    -- before the owning record finishes being created (upload-then-attach
    -- flow). Ownership/RBAC is enforced by the owning domain module, not by
    -- a DB constraint here — see the P0 remediation plan's classification
    -- design (megamall-audits/megamall-p0-remediation-plan-20260716.md §5-C).
    owner_entity_type     TEXT,
    owner_entity_id       UUID,

    uploaded_by_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

    processing_status     media_processing_status NOT NULL DEFAULT 'pending',
    -- original_storage_key lets a variant regenerate/reprocess without
    -- re-uploading if storage_key ever points at a derived/renamed asset;
    -- for the initial upload these are equal.
    original_storage_key  TEXT NOT NULL,
    -- variant_metadata holds {"thumbnail": {"key":..,"width":..,"height":..,"bytes":..}, "card": {...}, ...}
    -- for image categories; NULL for non-image categories (e.g. PDFs, which
    -- are never converted to a lossy raster variant per the pipeline design).
    variant_metadata      JSONB,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ,
    quarantined_at        TIMESTAMPTZ
);

CREATE INDEX idx_media_assets_owner ON media_assets (owner_entity_type, owner_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_assets_category ON media_assets (category) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_assets_uploaded_by ON media_assets (uploaded_by_user_id);
CREATE INDEX idx_media_assets_processing_status ON media_assets (processing_status) WHERE processing_status IN ('pending', 'processing');
-- Supports the retention-purge job scanning for quarantined rows past their window.
CREATE INDEX idx_media_assets_quarantined ON media_assets (quarantined_at) WHERE quarantined_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS media_assets;
DROP TYPE IF EXISTS media_processing_status;
DROP TYPE IF EXISTS media_category;
DROP TYPE IF EXISTS media_visibility;
-- +goose StatementEnd
