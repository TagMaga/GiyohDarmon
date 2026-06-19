package activity

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// BatchInsert inserts a slice of logs in a single statement.
func (r *Repository) BatchInsert(ctx context.Context, logs []Log) error {
	if len(logs) == 0 {
		return nil
	}
	if err := r.db.WithContext(ctx).Create(&logs).Error; err != nil {
		return fmt.Errorf("batch insert activity logs: %w", err)
	}
	return nil
}

// InsertTx inserts a single log inside an existing transaction.
// Used for compensation changes that must be synchronous.
func (r *Repository) InsertTx(tx *gorm.DB, log *Log) error {
	if err := tx.Create(log).Error; err != nil {
		return fmt.Errorf("insert activity log (tx): %w", err)
	}
	return nil
}
