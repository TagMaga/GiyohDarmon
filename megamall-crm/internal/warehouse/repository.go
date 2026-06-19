package warehouse

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles warehouse persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(ctx context.Context, p pagination.Params) ([]Warehouse, int, error) {
	var rows []Warehouse
	var total int64

	q := r.db.WithContext(ctx).Model(&Warehouse{})
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count warehouses: %w", err)
	}
	if err := q.Order("name ASC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list warehouses: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Warehouse, error) {
	var w Warehouse
	err := r.db.WithContext(ctx).First(&w, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get warehouse: %w", err)
	}
	return &w, nil
}

func (r *Repository) Create(ctx context.Context, w *Warehouse) error {
	if err := r.db.WithContext(ctx).Create(w).Error; err != nil {
		return fmt.Errorf("create warehouse: %w", err)
	}
	return nil
}

func (r *Repository) Update(ctx context.Context, w *Warehouse) error {
	if err := r.db.WithContext(ctx).Save(w).Error; err != nil {
		return fmt.Errorf("update warehouse: %w", err)
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, id uuid.UUID) error {
	if err := r.db.WithContext(ctx).Delete(&Warehouse{}, "id = ?", id).Error; err != nil {
		return fmt.Errorf("delete warehouse: %w", err)
	}
	return nil
}

// ExistsByID is used by the inventory module to validate FK references.
func (r *Repository) ExistsByID(ctx context.Context, id uuid.UUID) (bool, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&Warehouse{}).Where("id = ? AND is_active = true", id).Count(&count).Error; err != nil {
		return false, fmt.Errorf("check warehouse exists: %w", err)
	}
	return count > 0, nil
}
