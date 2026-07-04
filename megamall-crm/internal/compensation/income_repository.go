package compensation

// income_repository.go — Repository methods for Phase 14 income reporting.
//
// All queries exploit the existing indexes from migration 00010:
//   idx_fin_events_user_id   ON (user_id, event_type, created_at DESC)
//   idx_fin_events_type_date ON (event_type, created_at DESC)
//   idx_fin_events_order_id  ON (order_id)

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// ─── Income summary ───────────────────────────────────────────────────────────

// GetUserIncomeTotal returns total income and distinct order count for a user.
// company_revenue_earned is naturally excluded because those rows have user_id NULL.
func (r *Repository) GetUserIncomeTotal(
	ctx context.Context,
	userID uuid.UUID,
	filter FinancialEventFilter,
) (totalIncome float64, ordersCount int, err error) {
	q := r.db.WithContext(ctx).
		Table("financial_events").
		Select("COALESCE(SUM(amount), 0) AS total_income, COUNT(DISTINCT order_id) AS orders_count").
		Where("user_id = ?", userID)

	q = r.applyIncomeFilter(q, filter)

	var row incomeTotalRow
	if scanErr := q.Scan(&row).Error; scanErr != nil {
		return 0, 0, fmt.Errorf("get user income total: %w", scanErr)
	}
	return row.TotalIncome, row.OrdersCount, nil
}

// GetUserIncomeByType returns per-event-type totals for a user (GROUP BY event_type).
func (r *Repository) GetUserIncomeByType(
	ctx context.Context,
	userID uuid.UUID,
	filter FinancialEventFilter,
) ([]incomeAggRow, error) {
	q := r.db.WithContext(ctx).
		Table("financial_events").
		Select("event_type, COALESCE(SUM(amount), 0) AS total, COUNT(DISTINCT order_id) AS orders_count").
		Where("user_id = ?", userID)

	q = r.applyIncomeFilter(q, filter)

	var rows []incomeAggRow
	if err := q.Group("event_type").Order("event_type").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("get user income by type: %w", err)
	}
	return rows, nil
}

func (r *Repository) GetUserIncomeOrderTotals(
	ctx context.Context,
	userID uuid.UUID,
	filter FinancialEventFilter,
) (incomeOrderTotalsRow, error) {
	from := filter.From
	to := filter.To
	typeWhere := ""
	typeArgs := []interface{}{}
	if filter.EventType != "" {
		typeWhere = "AND fe.event_type = ?"
		typeArgs = append(typeArgs, filter.EventType)
	}

	args := []interface{}{userID, from, to}
	args = append(args, typeArgs...)

	var row incomeOrderTotalsRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(x.total_amount), 0)  AS total_revenue,
			COALESCE(SUM(x.delivery_fee), 0)  AS total_delivery_fee,
			COALESCE(SUM(x.net_revenue), 0)   AS total_net_revenue
		FROM (
			SELECT DISTINCT ON (o.id)
				o.id,
				COALESCE(o.total_amount, 0)  AS total_amount,
				COALESCE(o.delivery_fee, 0)  AS delivery_fee,
				COALESCE(o.net_revenue, 0)   AS net_revenue
			FROM financial_events fe
			JOIN orders o ON o.id = fe.order_id AND o.deleted_at IS NULL
			WHERE fe.user_id    = ?
			  AND fe.created_at >= ?
			  AND fe.created_at <= ?
			  `+typeWhere+`
		) x
	`, args...).Scan(&row).Error
	if err != nil {
		return incomeOrderTotalsRow{}, fmt.Errorf("get user income order totals: %w", err)
	}
	return row, nil
}

// GetUserIncomeEvents returns enriched event rows (joined with orders metadata).
// Used when include_events=true is requested.
func (r *Repository) GetUserIncomeEvents(
	ctx context.Context,
	userID uuid.UUID,
	filter FinancialEventFilter,
	p pagination.Params,
) ([]incomeEventRow, int, error) {
	// Count first — plain table scan, no JOIN needed.
	cq := r.db.WithContext(ctx).Table("financial_events").Where("user_id = ?", userID)
	cq = r.applyIncomeFilter(cq, filter)
	var total int64
	if err := cq.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count income events: %w", err)
	}

	// Build the enriched query.  raw SQL is cleanest for the JOIN + aliases.
	from := filter.From
	to := filter.To
	typeWhere := ""
	typeArgs := []interface{}{}
	if filter.EventType != "" {
		typeWhere = "AND fe.event_type = ?"
		typeArgs = append(typeArgs, filter.EventType)
	}

	args := []interface{}{userID, from, to}
	args = append(args, typeArgs...)
	args = append(args, p.Limit, p.Offset())

	var rows []incomeEventRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			fe.id,
			fe.order_id,
			fe.event_type,
			fe.amount,
			fe.created_at,
			COALESCE(o.order_number,        '')  AS order_number,
			COALESCE(o.order_type::text,    '')  AS order_type,
			COALESCE(o.net_revenue,   0)  AS net_revenue,
			COALESCE(o.total_amount,  0)  AS total_amount,
			COALESCE(o.delivery_fee,  0)  AS delivery_fee
		FROM financial_events fe
		LEFT JOIN orders o ON o.id = fe.order_id
		WHERE fe.user_id    =  ?
		  AND fe.created_at >= ?
		  AND fe.created_at <= ?
		  `+typeWhere+`
		ORDER BY fe.created_at DESC
		LIMIT ? OFFSET ?
	`, args...).Scan(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("get income events: %w", err)
	}
	return rows, int(total), nil
}

// ─── Team income ──────────────────────────────────────────────────────────────

// GetTeamIncomeSummary returns per-member, per-event-type income for all users
// whose orders have team_lead_id = teamLeadID over the given period.
func (r *Repository) GetTeamIncomeSummary(
	ctx context.Context,
	teamLeadID uuid.UUID,
	from, to time.Time,
) ([]teamMemberIncomeRow, error) {
	var rows []teamMemberIncomeRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			fe.user_id,
			fe.event_type,
			COALESCE(SUM(fe.amount), 0)  AS total,
			COUNT(DISTINCT fe.order_id)  AS orders_count
		FROM financial_events fe
		JOIN orders o ON o.id = fe.order_id AND o.deleted_at IS NULL
		WHERE o.team_lead_id = ?
		  AND fe.user_id     IS NOT NULL
		  AND fe.created_at >= ?
		  AND fe.created_at <= ?
		GROUP BY fe.user_id, fe.event_type
		ORDER BY fe.user_id, fe.event_type
	`, teamLeadID, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get team income summary: %w", err)
	}
	return rows, nil
}

// ─── Extended events list ─────────────────────────────────────────────────────

// ListFinancialEventsByFilter returns paginated, multi-filter financial events.
// Used by the extended GET /hr/events handler.
// When filter.IncludeCompany is false, company_revenue_earned rows are omitted.
func (r *Repository) ListFinancialEventsByFilter(
	ctx context.Context,
	filter FinancialEventFilter,
	p pagination.Params,
) ([]FinancialEvent, int, error) {
	q := r.db.WithContext(ctx).Model(&FinancialEvent{})

	if filter.OrderID != nil {
		q = q.Where("order_id = ?", filter.OrderID)
	}
	if filter.UserID != nil {
		q = q.Where("user_id = ?", filter.UserID)
	}
	if filter.EventType != "" {
		q = q.Where("event_type = ?", filter.EventType)
	}
	if filter.From != nil {
		q = q.Where("created_at >= ?", filter.From)
	}
	if filter.To != nil {
		q = q.Where("created_at <= ?", filter.To)
	}
	if !filter.IncludeCompany {
		q = q.Where("event_type != 'company_revenue_earned'")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count filtered events: %w", err)
	}

	var rows []FinancialEvent
	if err := q.Order("created_at DESC").
		Limit(p.Limit).
		Offset(p.Offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list filtered events: %w", err)
	}
	return rows, int(total), nil
}

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

// CanManagerAccessUser returns true when at least one order exists where
// manager_id = managerID AND seller_id = targetUserID.
func (r *Repository) CanManagerAccessUser(
	ctx context.Context,
	managerID, targetUserID uuid.UUID,
) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("orders").
		Where("manager_id = ? AND seller_id = ? AND deleted_at IS NULL", managerID, targetUserID).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check manager access: %w", err)
	}
	return count > 0, nil
}

// CanTeamLeadAccessUser returns true when at least one order exists where
// team_lead_id = teamLeadID AND seller_id = targetUserID.
func (r *Repository) CanTeamLeadAccessUser(
	ctx context.Context,
	teamLeadID, targetUserID uuid.UUID,
) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("orders").
		Where("team_lead_id = ? AND seller_id = ? AND deleted_at IS NULL", teamLeadID, targetUserID).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check team lead access: %w", err)
	}
	return count > 0, nil
}

// ─── Private helpers ──────────────────────────────────────────────────────────

// applyIncomeFilter applies the optional From, To, and EventType predicates to q.
func (r *Repository) applyIncomeFilter(q *gorm.DB, filter FinancialEventFilter) *gorm.DB {
	if filter.From != nil {
		q = q.Where("created_at >= ?", filter.From)
	}
	if filter.To != nil {
		q = q.Where("created_at <= ?", filter.To)
	}
	if filter.EventType != "" {
		q = q.Where("event_type = ?", filter.EventType)
	}
	return q
}
