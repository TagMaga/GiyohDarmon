package seller_payouts

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Repository handles DB access for seller_payouts.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ListBySellerID returns all payouts for a seller ordered by created_at desc.
func (r *Repository) ListBySellerID(ctx context.Context, sellerID uuid.UUID) ([]SellerPayout, error) {
	var payouts []SellerPayout
	err := r.db.WithContext(ctx).
		Where("seller_id = ?", sellerID).
		Order("created_at DESC").
		Find(&payouts).Error
	return payouts, err
}
