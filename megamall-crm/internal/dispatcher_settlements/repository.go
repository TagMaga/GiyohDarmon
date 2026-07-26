package dispatcher_settlements

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles DB access for dispatcher_settlements, plus the direct
// cash_handovers aggregation needed for the "received" and "courier debt"
// halves of Summary — mirrors the pattern already used by payouts (querying
// another module's table directly for read-only aggregation rather than
// injecting its repository).
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// sumReceived totals confirmed cash_handovers.actual_returned — cash
// dispatchers have collected from couriers — optionally scoped to one
// dispatcher and a date range (on cash_handovers.created_at, matching
// logistics.ListHandovers' filter convention).
func (r *Repository) sumReceived(ctx context.Context, f SummaryFilter) (float64, error) {
	q := r.db.WithContext(ctx).Table("cash_handovers").
		Where("status = ?", "confirmed")
	if f.DispatcherID != nil {
		q = q.Where("dispatcher_id = ?", *f.DispatcherID)
	}
	if f.From != nil {
		q = q.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("created_at <= ?", *f.To)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(COALESCE(actual_returned, total_to_return)), 0)").Scan(&total).Error; err != nil {
		return 0, fmt.Errorf("sum received: %w", err)
	}
	return total, nil
}

// sumPaid totals confirmed dispatcher_settlements.amount — cash dispatchers
// have remitted to the company.
func (r *Repository) sumPaid(ctx context.Context, f SummaryFilter) (float64, error) {
	q := r.db.WithContext(ctx).Table("dispatcher_settlements").
		Where("status = ?", StatusConfirmed)
	if f.DispatcherID != nil {
		q = q.Where("dispatcher_id = ?", *f.DispatcherID)
	}
	if f.From != nil {
		q = q.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("created_at <= ?", *f.To)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, fmt.Errorf("sum paid: %w", err)
	}
	return total, nil
}

// sumCourierDebt totals what couriers still owe: orders delivered but not
// yet part of a confirmed handover, plus the net shortfall on confirmed
// handovers — same formula as logistics.ListCouriers' debt_cte/shortfall_cte,
// summed across all couriers instead of grouped per-courier.
//
// When DispatcherID is set, only the shortfall half (attributable to the
// dispatcher who confirmed the handover) is scoped to them — orders not yet
// handed over to any dispatcher can't be attributed to one, so that half
// stays global. This is a best-effort scoping, not an exact per-dispatcher
// split.
func (r *Repository) sumCourierDebt(ctx context.Context, f SummaryFilter) (float64, error) {
	debtQ := r.db.WithContext(ctx).Table("orders o").
		Where("o.courier_id IS NOT NULL AND o.status = 'delivered' AND o.deleted_at IS NULL").
		Where(`o.id NOT IN (
			SELECT cho.order_id FROM cash_handover_orders cho
			JOIN cash_handovers ch ON ch.id = cho.handover_id
			WHERE ch.status = 'confirmed'
		)`)
	var debt float64
	if err := debtQ.Select(`COALESCE(SUM(GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0) - COALESCE(o.courier_payout,0))), 0)`).
		Scan(&debt).Error; err != nil {
		return 0, fmt.Errorf("sum courier debt (undelivered handovers): %w", err)
	}

	shortfallQ := r.db.WithContext(ctx).Table("cash_handovers").Where("status = 'confirmed'")
	if f.DispatcherID != nil {
		shortfallQ = shortfallQ.Where("dispatcher_id = ?", *f.DispatcherID)
	}
	if f.From != nil {
		shortfallQ = shortfallQ.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		shortfallQ = shortfallQ.Where("created_at <= ?", *f.To)
	}
	var shortfall float64
	if err := shortfallQ.Select(`COALESCE(SUM(total_to_return - COALESCE(actual_returned, total_to_return)), 0)`).
		Scan(&shortfall).Error; err != nil {
		return 0, fmt.Errorf("sum courier debt (shortfall): %w", err)
	}

	total := debt + shortfall
	if total < 0 {
		total = 0
	}
	return total, nil
}

// GetSummary computes the four KPI figures shown on both the owner and
// dispatcher cash tabs.
func (r *Repository) GetSummary(ctx context.Context, f SummaryFilter) (Summary, error) {
	received, err := r.sumReceived(ctx, f)
	if err != nil {
		return Summary{}, err
	}
	paid, err := r.sumPaid(ctx, f)
	if err != nil {
		return Summary{}, err
	}
	courierDebt, err := r.sumCourierDebt(ctx, f)
	if err != nil {
		return Summary{}, err
	}
	dispatcherDebt := received - paid
	if dispatcherDebt < 0 {
		dispatcherDebt = 0
	}
	return Summary{
		CourierDebt:    courierDebt,
		Received:       received,
		Paid:           paid,
		DispatcherDebt: dispatcherDebt,
	}, nil
}

// List returns settlement history rows, newest first.
func (r *Repository) List(ctx context.Context, f ListFilter, p pagination.Params) ([]Row, int, error) {
	q := r.db.WithContext(ctx).Table("dispatcher_settlements ds").
		Select(`
			ds.id,
			ds.dispatcher_id,
			u.full_name AS dispatcher_name,
			ds.amount,
			ds.status,
			ds.comment,
			ds.rejection_reason,
			ds.reviewed_by,
			ru.full_name AS reviewed_by_name,
			ds.reviewed_at,
			ds.created_at
		`).
		Joins("JOIN users u ON u.id = ds.dispatcher_id").
		Joins("LEFT JOIN users ru ON ru.id = ds.reviewed_by")

	if f.DispatcherID != nil {
		q = q.Where("ds.dispatcher_id = ?", *f.DispatcherID)
	}
	if f.Status != "" {
		q = q.Where("ds.status = ?", f.Status)
	}
	if f.From != nil {
		q = q.Where("ds.created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("ds.created_at <= ?", *f.To)
	}

	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count settlements: %w", err)
	}

	var rows []Row
	err := q.Order("ds.created_at DESC").
		Offset((p.Page - 1) * p.Limit).
		Limit(p.Limit).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list settlements: %w", err)
	}
	return rows, int(total), nil
}

// OutstandingBalance is the dispatcher's current received-minus-paid debt,
// used to size a "pay all" submission server-side.
func (r *Repository) OutstandingBalance(ctx context.Context, dispatcherID uuid.UUID) (float64, error) {
	summary, err := r.GetSummary(ctx, SummaryFilter{DispatcherID: &dispatcherID})
	if err != nil {
		return 0, err
	}
	return summary.DispatcherDebt, nil
}

func (r *Repository) Create(ctx context.Context, s *Settlement) error {
	if err := r.db.WithContext(ctx).Create(s).Error; err != nil {
		return fmt.Errorf("create settlement: %w", err)
	}
	return nil
}

func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (*Settlement, error) {
	var s Settlement
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) Review(ctx context.Context, id uuid.UUID, reviewerID uuid.UUID, status string, rejectionReason *string) (*Settlement, error) {
	updates := map[string]interface{}{
		"status":      status,
		"reviewed_by": reviewerID,
		"reviewed_at": gorm.Expr("NOW()"),
	}
	if rejectionReason != nil {
		updates["rejection_reason"] = *rejectionReason
	}
	if err := r.db.WithContext(ctx).Model(&Settlement{}).
		Where("id = ? AND status = ?", id, StatusPending).
		Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("review settlement: %w", err)
	}
	return r.FindByID(ctx, id)
}
