package payouts

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Repository handles DB access for payouts, plus the small amount of direct
// cross-table SQL (orders, users) needed for the payables aggregation —
// mirrors the pattern already used by compensation/income_repository.go,
// which also queries `orders` directly rather than going through another
// module's repository.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// CreateBatch inserts all payouts in a single transaction — all-or-nothing
// for the bulk "Выплатить" action.
func (r *Repository) CreateBatch(ctx context.Context, rows []*Payout) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			if err := tx.Create(row).Error; err != nil {
				return fmt.Errorf("create payout: %w", err)
			}
		}
		return nil
	})
}

// ListByPayee returns all payouts received by a payee, newest first.
func (r *Repository) ListByPayee(ctx context.Context, payeeID uuid.UUID) ([]Payout, error) {
	var rows []Payout
	err := r.db.WithContext(ctx).
		Where("payee_id = ?", payeeID).
		Order("created_at DESC").
		Find(&rows).Error
	return rows, err
}

// ListByPayer returns all payouts made by a payer within an optional period,
// newest first — used to show "payments I've already made" history.
func (r *Repository) ListByPayer(ctx context.Context, payerID uuid.UUID, from, to *time.Time) ([]Payout, error) {
	q := r.db.WithContext(ctx).Where("payer_id = ?", payerID)
	if from != nil {
		q = q.Where("period_end >= ?", *from)
	}
	if to != nil {
		q = q.Where("period_start <= ?", *to)
	}
	var rows []Payout
	err := q.Order("created_at DESC").Find(&rows).Error
	return rows, err
}

// SumPaidGroupedByPayee returns, for a given payer and period, how much has
// already been paid to each payee (period overlap semantics: any payout whose
// [period_start, period_end] overlaps the requested window counts).
func (r *Repository) SumPaidGroupedByPayee(ctx context.Context, payerID uuid.UUID, from, to time.Time) (map[uuid.UUID]float64, error) {
	type row struct {
		PayeeID uuid.UUID
		Total   float64
	}
	var rows []row
	err := r.db.WithContext(ctx).
		Table("payouts").
		Select("payee_id, COALESCE(SUM(amount), 0) AS total").
		Where("payer_id = ? AND period_start <= ? AND period_end >= ?", payerID, to, from).
		Group("payee_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("sum paid grouped by payee: %w", err)
	}
	out := make(map[uuid.UUID]float64, len(rows))
	for _, rw := range rows {
		out[rw.PayeeID] = rw.Total
	}
	return out, nil
}

// orderTotalsRow is one line of the gross-order-value aggregation.
type orderTotalsRow struct {
	UserID      uuid.UUID
	GrossAmount float64
	OrdersCount int
}

// GetTeamOrderGrossTotals returns, for every user who appears as either the
// seller or the overseeing manager on an order under this team lead in the
// period, their gross order value + order count ("Сумма заказов" tile).
// A manager's own personal orders (seller_id = manager) are counted once via
// the seller branch, not double-counted with the manager branch.
func (r *Repository) GetTeamOrderGrossTotals(ctx context.Context, teamLeadID uuid.UUID, from, to time.Time) (map[uuid.UUID]orderTotalsRow, error) {
	var rows []orderTotalsRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT user_id, COALESCE(SUM(total_amount), 0) AS gross_amount, COUNT(*) AS orders_count
		FROM (
			SELECT id, seller_id AS user_id, total_amount
			FROM orders
			WHERE team_lead_id = ? AND deleted_at IS NULL
			  AND created_at >= ? AND created_at <= ?
			UNION ALL
			SELECT id, manager_id AS user_id, total_amount
			FROM orders
			WHERE team_lead_id = ? AND manager_id IS NOT NULL AND manager_id != seller_id
			  AND deleted_at IS NULL AND created_at >= ? AND created_at <= ?
		) t
		GROUP BY user_id
	`, teamLeadID, from, to, teamLeadID, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get team order gross totals: %w", err)
	}
	out := make(map[uuid.UUID]orderTotalsRow, len(rows))
	for _, rw := range rows {
		out[rw.UserID] = rw
	}
	return out, nil
}

// userInfo is the minimal user data needed to render a payables row.
type userInfo struct {
	ID       uuid.UUID
	FullName string
	Role     string
}

// GetUsersByIDs resolves role + name for a set of user IDs — never trust the
// client for a payee's role.
func (r *Repository) GetUsersByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]userInfo, error) {
	if len(ids) == 0 {
		return map[uuid.UUID]userInfo{}, nil
	}
	var rows []userInfo
	err := r.db.WithContext(ctx).
		Table("users").
		Select("id, full_name, role").
		Where("id IN ?", ids).
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get users by ids: %w", err)
	}
	out := make(map[uuid.UUID]userInfo, len(rows))
	for _, rw := range rows {
		out[rw.ID] = rw
	}
	return out, nil
}

// GetUserRole resolves a single user's role (used for payer_role on create).
func (r *Repository) GetUserRole(ctx context.Context, id uuid.UUID) (string, error) {
	var role string
	err := r.db.WithContext(ctx).Table("users").Select("role").Where("id = ?", id).Scan(&role).Error
	if err != nil {
		return "", fmt.Errorf("get user role: %w", err)
	}
	return role, nil
}
