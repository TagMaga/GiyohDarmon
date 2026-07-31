package notifications

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles all notification persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, n *Notification) error {
	return r.db.WithContext(ctx).Create(n).Error
}

func (r *Repository) ListForUser(ctx context.Context, userID uuid.UUID, p pagination.Params) ([]Notification, int, error) {
	var rows []Notification
	var total int64

	q := r.db.WithContext(ctx).Model(&Notification{}).Where("user_id = ?", userID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count notifications: %w", err)
	}
	if err := q.Order("created_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list notifications: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Notification{}).
		Where("user_id = ? AND read_at IS NULL", userID).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("unread count: %w", err)
	}
	return int(count), nil
}

func (r *Repository) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	now := time.Now().UTC()
	return r.db.WithContext(ctx).Model(&Notification{}).
		Where("id = ? AND user_id = ? AND read_at IS NULL", id, userID).
		Update("read_at", now).Error
}

func (r *Repository) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	now := time.Now().UTC()
	return r.db.WithContext(ctx).Model(&Notification{}).
		Where("user_id = ? AND read_at IS NULL", userID).
		Update("read_at", now).Error
}
