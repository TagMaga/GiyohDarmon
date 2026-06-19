package finance

// repository.go — Database queries for Phase 15 Owner Finance Dashboard.
//
// Indexes used:
//   idx_orders_created_at          ON orders(created_at)          [from migration 00010]
//   idx_orders_status              ON orders(status)              [from migration 00010]
//   idx_fin_events_type_date       ON financial_events(event_type, created_at DESC) [00010]
//   idx_cash_handovers_created_at  ON cash_handovers(created_at DESC) [added in 00035]
//   idx_cash_handovers_status      ON cash_handovers(status)      [from migration 00032]
//
// All queries run as single-round-trip aggregations — no pagination needed for summary.

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository wraps *gorm.DB for all finance queries.
type Repository struct {
	db *gorm.DB
}

// NewRepository creates a new finance Repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ─── Summary ──────────────────────────────────────────────────────────────────

// GetOrdersSummary returns aggregate order metrics for orders delivered in [from, to].
//
// Date anchor: order_timeline.created_at WHERE to_status = 'delivered', NOT orders.created_at.
// This ensures "revenue today" means orders that were actually delivered today, not merely
// created today. Index idx_order_timeline_status_date (migration 00043) covers this scan.
func (r *Repository) GetOrdersSummary(
	ctx context.Context,
	from, to time.Time,
) (ordersSummaryRow, error) {
	var row ordersSummaryRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(*)                                    AS total_count,
			COALESCE(SUM(o.total_amount), 0)            AS total_sales,
			COALESCE(SUM(o.delivery_fee), 0)            AS delivery_fees,
			COALESCE(SUM(o.net_revenue), 0)             AS net_revenue
		FROM orders o
		JOIN order_timeline tl ON tl.order_id = o.id
		WHERE o.deleted_at   IS NULL
		  AND tl.to_status   = 'delivered'
		  AND tl.created_at >= ?
		  AND tl.created_at <= ?
	`, from, to).Scan(&row).Error
	if err != nil {
		return ordersSummaryRow{}, fmt.Errorf("get orders summary: %w", err)
	}
	return row, nil
}

// GetRevenueSummary returns per-event-type totals from financial_events in [from, to].
// Orphan events (order_id IS NULL) are excluded — these represent deleted-order artefacts.
func (r *Repository) GetRevenueSummary(
	ctx context.Context,
	from, to time.Time,
) ([]eventAggRow, error) {
	var rows []eventAggRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			event_type::text          AS event_type,
			COALESCE(SUM(amount), 0)  AS total
		FROM financial_events
		WHERE order_id   IS NOT NULL
		  AND created_at >= ?
		  AND created_at <= ?
		GROUP BY event_type
		ORDER BY event_type
	`, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get revenue summary: %w", err)
	}
	return rows, nil
}

// GetCashSummary returns aggregate cash handover metrics in [from, to].
func (r *Repository) GetCashSummary(
	ctx context.Context,
	from, to time.Time,
) (cashSummaryRow, error) {
	var row cashSummaryRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(*) FILTER (WHERE status = 'confirmed')                           AS confirmed_count,
			COUNT(*) FILTER (WHERE status = 'pending')                             AS pending_count,
			COALESCE(SUM(total_collected)  FILTER (WHERE status = 'confirmed'), 0) AS cash_collected,
			COALESCE(SUM(actual_returned)  FILTER (WHERE status = 'confirmed'), 0) AS cash_returned
		FROM cash_handovers
		WHERE created_at >= ?
		  AND created_at <= ?
	`, from, to).Scan(&row).Error
	if err != nil {
		return cashSummaryRow{}, fmt.Errorf("get cash summary: %w", err)
	}
	return row, nil
}

// ─── Events list ──────────────────────────────────────────────────────────────

// ListFinancialEvents returns paginated financial_events rows for owner view.
// All event types are included (including company_revenue_earned with user_id=NULL).
// eventType="" means no event_type filter.
func (r *Repository) ListFinancialEvents(
	ctx context.Context,
	from, to time.Time,
	eventType string,
	p pagination.Params,
) ([]FinanceEventResponse, int, error) {
	// Count
	cq := r.db.WithContext(ctx).Table("financial_events").
		Where("created_at >= ? AND created_at <= ?", from, to)
	if eventType != "" {
		cq = cq.Where("event_type = ?", eventType)
	}
	var total int64
	if err := cq.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count finance events: %w", err)
	}

	// Fetch rows
	q := r.db.WithContext(ctx).Raw(`
		SELECT
			id,
			order_id,
			user_id,
			event_type::text AS event_type,
			amount,
			created_at
		FROM financial_events
		WHERE created_at >= ?
		  AND created_at <= ?
		`+eventTypeClause(eventType)+`
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, eventArgs(from, to, eventType, p.Limit, p.Offset())...)

	var rows []FinanceEventResponse
	if err := q.Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list finance events: %w", err)
	}
	return rows, int(total), nil
}

// ─── Cash list ────────────────────────────────────────────────────────────────

// ListCashHandovers returns paginated cash_handovers rows for owner view.
func (r *Repository) ListCashHandovers(
	ctx context.Context,
	from, to time.Time,
	p pagination.Params,
) ([]handoverRow, int, error) {
	base := r.db.WithContext(ctx).Table("cash_handovers").
		Where("created_at >= ? AND created_at <= ?", from, to)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count cash handovers: %w", err)
	}

	var rows []handoverRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			id,
			courier_id,
			dispatcher_id,
			total_collected,
			total_delivery_fees,
			total_to_return,
			actual_returned,
			status::text AS status,
			proof_url,
			comment,
			confirmed_at,
			created_at
		FROM cash_handovers
		WHERE created_at >= ?
		  AND created_at <= ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, from, to, p.Limit, p.Offset()).Scan(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list cash handovers: %w", err)
	}
	return rows, int(total), nil
}

// ─── Phase 5D aggregations ────────────────────────────────────────────────────

// GetDailyRevenue returns one DailyPoint per calendar day in [from, to].
// Anchored on order_timeline.created_at WHERE to_status='delivered' (same as GetOrdersSummary).
// company_revenue comes from financial_events joined per order.
func (r *Repository) GetDailyRevenue(
	ctx context.Context,
	from, to time.Time,
) ([]dailyRow, error) {
	var rows []dailyRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			tl.created_at::date                                                            AS date,
			COUNT(*)                                                                       AS orders_count,
			COALESCE(SUM(o.total_amount), 0)                                               AS total_sales,
			COALESCE(SUM(o.delivery_fee), 0)                                               AS delivery_fees,
			COALESCE(SUM(fe.amount) FILTER (WHERE fe.event_type = 'company_revenue_earned'), 0) AS company_revenue
		FROM orders o
		JOIN order_timeline tl ON tl.order_id = o.id
		LEFT JOIN financial_events fe ON fe.order_id = o.id
		WHERE o.deleted_at  IS NULL
		  AND tl.to_status  = 'delivered'
		  AND tl.created_at >= ?
		  AND tl.created_at <= ?
		GROUP BY tl.created_at::date
		ORDER BY tl.created_at::date
	`, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get daily revenue: %w", err)
	}
	return rows, nil
}

// GetSellerPerformance returns top sellers ranked by total_revenue for [from, to].
// Only orders that transitioned to 'delivered' in the period are counted.
func (r *Repository) GetSellerPerformance(
	ctx context.Context,
	from, to time.Time,
	limit int,
) ([]sellerPerfRow, error) {
	if limit <= 0 {
		limit = 10
	}
	var rows []sellerPerfRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			o.seller_id,
			u.full_name,
			COUNT(*)                                                                             AS orders_count,
			COALESCE(SUM(o.total_amount), 0)                                                     AS total_revenue,
			COALESCE(SUM(fe.amount) FILTER (WHERE fe.event_type = 'seller_commission_earned'), 0) AS total_commission
		FROM orders o
		JOIN order_timeline tl ON tl.order_id = o.id
		JOIN users u ON u.id = o.seller_id
		LEFT JOIN financial_events fe ON fe.order_id = o.id
		WHERE o.deleted_at  IS NULL
		  AND tl.to_status  = 'delivered'
		  AND tl.created_at >= ?
		  AND tl.created_at <= ?
		GROUP BY o.seller_id, u.full_name
		ORDER BY total_revenue DESC
		LIMIT ?
	`, from, to, limit).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get seller performance: %w", err)
	}
	return rows, nil
}

// GetTeamPerformance returns team-level aggregates ranked by total_revenue for [from, to].
// Orders with NULL team_lead_id are excluded (no team assigned).
func (r *Repository) GetTeamPerformance(
	ctx context.Context,
	from, to time.Time,
) ([]teamPerfRow, error) {
	var rows []teamPerfRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			o.team_lead_id,
			COALESCE(t.name, '')                                                                   AS team_name,
			COALESCE(u.full_name, '')                                                              AS team_lead_name,
			COUNT(*)                                                                               AS orders_count,
			COALESCE(SUM(o.total_amount), 0)                                                       AS total_revenue,
			COALESCE(SUM(fe.amount) FILTER (WHERE fe.event_type = 'company_revenue_earned'), 0)    AS company_revenue
		FROM orders o
		JOIN order_timeline tl ON tl.order_id = o.id
		LEFT JOIN teams t  ON t.team_lead_id = o.team_lead_id AND t.deleted_at IS NULL
		LEFT JOIN users u  ON u.id           = o.team_lead_id
		LEFT JOIN financial_events fe ON fe.order_id = o.id
		WHERE o.deleted_at    IS NULL
		  AND o.team_lead_id  IS NOT NULL
		  AND tl.to_status    = 'delivered'
		  AND tl.created_at  >= ?
		  AND tl.created_at  <= ?
		GROUP BY o.team_lead_id, t.name, u.full_name
		ORDER BY total_revenue DESC
	`, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get team performance: %w", err)
	}
	return rows, nil
}

// ─── Private helpers ──────────────────────────────────────────────────────────

// eventTypeClause returns a safe SQL fragment for the optional event_type filter.
// Using string concat is fine here because eventType is validated against known
// enum values before this function is called.  The value is still passed as a
// bound parameter via eventArgs, not interpolated.
func eventTypeClause(eventType string) string {
	if eventType == "" {
		return ""
	}
	return "AND event_type = ?"
}

// eventArgs builds the args slice for ListFinancialEvents raw SQL.
func eventArgs(from, to time.Time, eventType string, limit, offset int) []interface{} {
	args := []interface{}{from, to}
	if eventType != "" {
		args = append(args, eventType)
	}
	args = append(args, limit, offset)
	return args
}

// ─── UUID helper for testing ──────────────────────────────────────────────────

// mustNewUUID returns a new random UUID. Used in tests; panics on failure.
func mustNewUUID() uuid.UUID { return uuid.New() }
