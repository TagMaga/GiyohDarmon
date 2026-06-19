package auth

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

// Save inserts a new refresh token record.
func (r *Repository) Save(ctx context.Context, t *RefreshToken) error {
	if err := r.db.WithContext(ctx).Create(t).Error; err != nil {
		return fmt.Errorf("save refresh token: %w", err)
	}
	return nil
}

// GetByHash looks up a refresh token by its SHA-256 hash.
func (r *Repository) GetByHash(ctx context.Context, hash string) (*RefreshToken, error) {
	var t RefreshToken
	err := r.db.WithContext(ctx).
		Where("token_hash = ?", hash).
		First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get refresh token by hash: %w", err)
	}
	return &t, nil
}

// RevokeToken sets revoked_at on a single token.
func (r *Repository) RevokeToken(ctx context.Context, id uuid.UUID) error {
	now := time.Now().UTC()
	err := r.db.WithContext(ctx).
		Model(&RefreshToken{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Update("revoked_at", now).Error
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	return nil
}

// RevokeFamily sets revoked_at on ALL tokens in a family.
// Called on token reuse detection to invalidate all sessions in the family.
func (r *Repository) RevokeFamily(ctx context.Context, familyID uuid.UUID) error {
	now := time.Now().UTC()
	err := r.db.WithContext(ctx).
		Model(&RefreshToken{}).
		Where("family_id = ? AND revoked_at IS NULL", familyID).
		Update("revoked_at", now).Error
	if err != nil {
		return fmt.Errorf("revoke token family: %w", err)
	}
	return nil
}

// RevokeAllForUser revokes all active refresh tokens for a user (logout all devices).
func (r *Repository) RevokeAllForUser(ctx context.Context, userID uuid.UUID) error {
	now := time.Now().UTC()
	err := r.db.WithContext(ctx).
		Model(&RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
	if err != nil {
		return fmt.Errorf("revoke all tokens for user: %w", err)
	}
	return nil
}
