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

// orderScopeClause returns the SQL predicate (and its args) restricting
// visibility to only the orders actorRole is entitled to see, using alias
// "o" for the orders table — mirrors the role switch in
// orders.Repository.List. An empty clause means "no restriction" (owner,
// dispatcher — both see every order per existing orders scoping). Any role
// not recognized here is denied by default.
//
// Customers carry no team/seller ownership column of their own — a customer
// can have orders from multiple sellers/teams over time — so visibility is
// derived transitively through the orders that reference them.
func orderScopeClause(actorID uuid.UUID, actorRole string) (string, []interface{}) {
	switch actorRole {
	case "owner", "dispatcher":
		return "", nil
	case "seller":
		return "o.seller_id = ?", []interface{}{actorID}
	case "manager":
		return "(o.seller_id = ? OR o.manager_id = ?)", []interface{}{actorID, actorID}
	case "sales_team_lead":
		return "(o.seller_id = ? OR o.team_lead_id = ?)", []interface{}{actorID, actorID}
	default:
		return "1 = 0", nil
	}
}

// applyCustomerScope restricts q to customers that have at least one
// non-deleted order visible to actorRole/actorID.
func applyCustomerScope(q *gorm.DB, actorID uuid.UUID, actorRole string) *gorm.DB {
	clause, args := orderScopeClause(actorID, actorRole)
	if clause == "" {
		return q
	}
	sub := "EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id AND o.deleted_at IS NULL AND " + clause + ")"
	return q.Where(sub, args...)
}

func (r *Repository) List(ctx context.Context, f ListCustomersFilter, actorID uuid.UUID, actorRole string, p pagination.Params) ([]Customer, int, error) {
	var rows []Customer
	var total int64

	q := r.db.WithContext(ctx).Model(&Customer{}).Where("customers.deleted_at IS NULL")
	q = applyCustomerScope(q, actorID, actorRole)
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

// GetByID returns a customer by ID, restricted to actorRole/actorID's scope
// (see applyCustomerScope). Out-of-scope IDs return (nil, nil), same as a
// nonexistent ID, so callers can't distinguish "doesn't exist" from "not
// yours".
func (r *Repository) GetByID(ctx context.Context, id, actorID uuid.UUID, actorRole string) (*Customer, error) {
	var c Customer
	q := r.db.WithContext(ctx).Where("customers.id = ? AND customers.deleted_at IS NULL", id)
	q = applyCustomerScope(q, actorID, actorRole)
	err := q.First(&c).Error
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

// GetHistory aggregates order stats for a customer, over only the orders
// actorRole/actorID may see (same scope as applyCustomerScope) — otherwise a
// seller with a single legitimate order against a customer could read
// aggregate totals (total_spent, order counts, ...) that include every other
// seller's/team's orders with that same customer.
func (r *Repository) GetHistory(ctx context.Context, customerID, actorID uuid.UUID, actorRole string) (*historyRow, error) {
	var row historyRow
	q := r.db.WithContext(ctx).Table("orders o").
		Where("o.customer_id = ? AND o.deleted_at IS NULL", customerID)
	if clause, args := orderScopeClause(actorID, actorRole); clause != "" {
		q = q.Where(clause, args...)
	}
	err := q.Select(`
			COUNT(*)                                       AS total_orders,
			COALESCE(SUM(o.total_amount), 0)                AS total_spent,
			COUNT(*) FILTER (WHERE o.status = 'delivered')  AS delivered_count,
			COUNT(*) FILTER (WHERE o.status = 'cancelled')  AS cancelled_count,
			COUNT(*) FILTER (WHERE o.status = 'returned')   AS returned_count,
			MAX(o.created_at)                               AS last_order_at
		`).Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("get customer history: %w", err)
	}
	return &row, nil
}
