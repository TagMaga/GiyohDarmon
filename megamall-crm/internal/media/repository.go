package media

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, a *Asset) error {
	if err := r.db.WithContext(ctx).Create(a).Error; err != nil {
		return fmt.Errorf("create media asset: %w", err)
	}
	return nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Asset, error) {
	var a Asset
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get media asset: %w", err)
	}
	return &a, nil
}

// GetByStorageKey looks up a non-deleted asset by any of its storage keys
// (original or a variant's — variants aren't rows of their own, so this
// only ever matches the original_storage_key/storage_key columns; variant
// lookups go through the owning asset's VariantMetadata instead). Used by
// the delivery handler to resolve visibility/category for an incoming
// request path.
func (r *Repository) GetByStorageKey(ctx context.Context, key string) (*Asset, error) {
	var a Asset
	err := r.db.WithContext(ctx).
		Where("(storage_key = ? OR original_storage_key = ?) AND deleted_at IS NULL", key, key).
		First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get media asset by storage key: %w", err)
	}
	return &a, nil
}

func (r *Repository) UpdateProcessingResult(ctx context.Context, id uuid.UUID, status ProcessingStatus, variantJSON []byte, width, height *int) error {
	err := r.db.WithContext(ctx).Model(&Asset{}).Where("id = ?", id).Updates(map[string]any{
		"processing_status": status,
		"variant_metadata":  variantJSON,
		"width":             width,
		"height":            height,
		"updated_at":        time.Now(),
	}).Error
	if err != nil {
		return fmt.Errorf("update processing result: %w", err)
	}
	return nil
}

// SoftDeleteAndQuarantine implements the deletion contract: remove the DB
// association (soft-delete — deleted_at) and mark the row quarantined
// (quarantined_at) in the same update, so a single query change both
// "this asset is gone from the app's perspective" and "its file is now
// eligible for the retention-window purge job", atomically. The physical
// file itself is moved to quarantine storage by the caller (service.go),
// not here — the repository only owns DB state.
func (r *Repository) SoftDeleteAndQuarantine(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	err := r.db.WithContext(ctx).Model(&Asset{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(map[string]any{"deleted_at": now, "quarantined_at": now}).Error
	if err != nil {
		return fmt.Errorf("quarantine media asset: %w", err)
	}
	return nil
}

// ListPurgeable returns quarantined assets whose retention window has
// elapsed — candidates for the physical-file purge job. Rows are never
// deleted by this query; the purge job deletes the file then this row
// separately, so a crash mid-purge leaves the DB row (safe/inspectable)
// rather than the file (unrecoverable).
func (r *Repository) ListPurgeable(ctx context.Context, olderThan time.Time, limit int) ([]Asset, error) {
	var rows []Asset
	err := r.db.WithContext(ctx).
		Where("quarantined_at IS NOT NULL AND quarantined_at < ?", olderThan).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list purgeable media assets: %w", err)
	}
	return rows, nil
}

// ListOrphanedByOwner returns non-deleted assets whose owning record no
// longer exists — used by the "old comments/orders do not leave
// permanently public orphan files" reconciliation job. ownerTable/ownerIDs
// identify which rows in the *owning* table still exist; the caller
// supplies that set (queried from the owning domain module) since this
// repository has no FK/knowledge of arbitrary other tables.
func (r *Repository) ListOrphanedByOwner(ctx context.Context, ownerEntityType string, stillExistingIDs []uuid.UUID) ([]Asset, error) {
	var rows []Asset
	q := r.db.WithContext(ctx).
		Where("owner_entity_type = ? AND deleted_at IS NULL", ownerEntityType)
	if len(stillExistingIDs) > 0 {
		q = q.Where("owner_entity_id NOT IN ?", stillExistingIDs)
	}
	if err := q.Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list orphaned media assets: %w", err)
	}
	return rows, nil
}
