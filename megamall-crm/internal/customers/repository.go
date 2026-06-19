package customers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles all customer persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(ctx context.Context, f ListCustomersFilter, p pagination.Params) ([]Customer, int, error) {
	var rows []Customer
	var total int64

	q := r.db.WithContext(ctx).Model(&Customer{}).Where("deleted_at IS NULL")
	if f.Search != "" {
		like := "%" + f.Search + "%"
		q = q.Where("full_name ILIKE ? OR phone ILIKE ?", like, like)
	}
	if f.City != "" {
		q = q.Where("city ILIKE ?", "%"+f.City+"%")
	}
	if f.Source != "" {
		q = q.Where("source = ?", f.Source)
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count customers: %w", err)
	}
	if err := q.Order("created_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list customers: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Customer, error) {
	var c Customer
	err := r.db.WithContext(ctx).First(&c, "id = ? AND deleted_at IS NULL", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get customer: %w", err)
	}
	return &c, nil
}

func (r *Repository) Create(ctx context.Context, c *Customer) error {
	if err := r.db.WithContext(ctx).Create(c).Error; err != nil {
		return fmt.Errorf("create customer: %w", err)
	}
	return nil
}

func (r *Repository) Update(ctx context.Context, c *Customer) error {
	if err := r.db.WithContext(ctx).Save(c).Error; err != nil {
		return fmt.Errorf("update customer: %w", err)
	}
	return nil
}

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&Customer{}).
		Where("id = ? AND deleted_at IS NULL", id).
		UpdateColumn("deleted_at", gorm.Expr("NOW()"))
	if result.Error != nil {
		return fmt.Errorf("soft delete customer: %w", result.Error)
	}
	return nil
}

// historyRow is the raw aggregation result from the DB.
type historyRow struct {
	TotalOrders    int        `gorm:"column:total_orders"`
	TotalSpent     float64    `gorm:"column:total_spent"`
	DeliveredCount int        `gorm:"column:delivered_count"`
	CancelledCount int        `gorm:"column:cancelled_count"`
	ReturnedCount  int        `gorm:"column:returned_count"`
	LastOrderAt    *time.Time `gorm:"column:last_order_at"`
}

// GetHistory aggregates order stats for a customer.
func (r *Repository) GetHistory(ctx context.Context, customerID uuid.UUID) (*historyRow, error) {
	var row historyRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(*)                                                   AS total_orders,
			COALESCE(SUM(total_amount), 0)                             AS total_spent,
			COUNT(*) FILTER (WHERE status = 'delivered')               AS delivered_count,
			COUNT(*) FILTER (WHERE status = 'cancelled')               AS cancelled_count,
			COUNT(*) FILTER (WHERE status = 'returned')                AS returned_count,
			MAX(created_at)                                            AS last_order_at
		FROM orders
		WHERE customer_id = ? AND deleted_at IS NULL
	`, customerID).Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("get customer history: %w", err)
	}
	return &row, nil
}
