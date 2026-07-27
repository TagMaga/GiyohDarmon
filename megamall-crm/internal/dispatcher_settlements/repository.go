package dispatcher_settlements

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
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

// sumPaid totals confirmed dispatcher_settlements' actually-received amount
// — cash the owner counted as remitted to the company. Falls back to the
// declared amount when actual_received wasn't recorded (shouldn't happen
// for rows confirmed after the verification flow shipped, but keeps old
// rows from silently dropping out of the total).
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
	if err := q.Select("COALESCE(SUM(COALESCE(actual_received, amount)), 0)").Scan(&total).Error; err != nil {
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

// currentDebtByDispatcher computes each of the given dispatchers' current
// (unfiltered by date) outstanding debt to the company — same formula as
// GetSummary's DispatcherDebt, but batched for every ID at once so List
// doesn't run one query per row.
func (r *Repository) currentDebtByDispatcher(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]float64, error) {
	out := make(map[uuid.UUID]float64, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	var receivedRows []struct {
		DispatcherID uuid.UUID
		Total        float64
	}
	if err := r.db.WithContext(ctx).Table("cash_handovers").
		Select("dispatcher_id, COALESCE(SUM(COALESCE(actual_returned, total_to_return)), 0) AS total").
		Where("status = 'confirmed' AND dispatcher_id IN ?", ids).
		Group("dispatcher_id").
		Scan(&receivedRows).Error; err != nil {
		return nil, fmt.Errorf("current debt: received: %w", err)
	}

	var paidRows []struct {
		DispatcherID uuid.UUID
		Total        float64
	}
	if err := r.db.WithContext(ctx).Table("dispatcher_settlements").
		Select("dispatcher_id, COALESCE(SUM(COALESCE(actual_received, amount)), 0) AS total").
		Where("status = ? AND dispatcher_id IN ?", StatusConfirmed, ids).
		Group("dispatcher_id").
		Scan(&paidRows).Error; err != nil {
		return nil, fmt.Errorf("current debt: paid: %w", err)
	}

	received := make(map[uuid.UUID]float64, len(receivedRows))
	for _, row := range receivedRows {
		received[row.DispatcherID] = row.Total
	}
	for _, id := range ids {
		debt := received[id]
		for _, row := range paidRows {
			if row.DispatcherID == id {
				debt -= row.Total
				break
			}
		}
		if debt < 0 {
			debt = 0
		}
		out[id] = debt
	}
	return out, nil
}

// List returns settlement history rows, newest first.
func (r *Repository) List(ctx context.Context, f ListFilter, p pagination.Params) ([]Row, int, error) {
	q := r.db.WithContext(ctx).Table("dispatcher_settlements ds").
		Select(`
			ds.id,
			ds.dispatcher_id,
			u.full_name AS dispatcher_name,
			ds.amount,
			ds.actual_received,
			ds.status,
			ds.comment,
			ds.admin_note,
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

	ids := make([]uuid.UUID, 0, len(rows))
	seen := make(map[uuid.UUID]bool, len(rows))
	for _, row := range rows {
		if !seen[row.DispatcherID] {
			seen[row.DispatcherID] = true
			ids = append(ids, row.DispatcherID)
		}
	}
	debtMap, err := r.currentDebtByDispatcher(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].CurrentDebt = debtMap[rows[i].DispatcherID]
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

// Confirm accepts a pending settlement at the owner-counted actualReceived
// amount, recording the decision in dispatcher_settlement_edits in the same
// transaction — mirrors logistics.Repository's handover confirm/reject +
// recordHandoverEdit pattern.
func (r *Repository) Confirm(ctx context.Context, id, reviewerID uuid.UUID, actualReceived float64, adminNote *string) (*Settlement, error) {
	existing, err := r.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("confirm settlement: %w", err)
	}
	after := *existing
	after.Status = StatusConfirmed
	after.ActualReceived = &actualReceived
	after.AdminNote = adminNote

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"status":          StatusConfirmed,
			"actual_received": actualReceived,
			"reviewed_by":     reviewerID,
			"reviewed_at":     gorm.Expr("NOW()"),
		}
		if adminNote != nil {
			updates["admin_note"] = *adminNote
		}
		if err := tx.Table("dispatcher_settlements").Where("id = ? AND status = ?", id, StatusPending).Updates(updates).Error; err != nil {
			return fmt.Errorf("confirm settlement: %w", err)
		}
		return recordSettlementEdit(tx, ctx, id, &reviewerID, "confirm", existing, &after, nil)
	})
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

// Reject declines a pending settlement with a required reason, recorded as
// both rejection_reason (surfaced directly on the row) and the edit's
// Reason (surfaced in history).
func (r *Repository) Reject(ctx context.Context, id, reviewerID uuid.UUID, reason string) (*Settlement, error) {
	existing, err := r.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("reject settlement: %w", err)
	}
	after := *existing
	after.Status = StatusRejected
	after.RejectionReason = &reason

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"status":           StatusRejected,
			"rejection_reason": reason,
			"reviewed_by":      reviewerID,
			"reviewed_at":      gorm.Expr("NOW()"),
		}
		if err := tx.Table("dispatcher_settlements").Where("id = ? AND status = ?", id, StatusPending).Updates(updates).Error; err != nil {
			return fmt.Errorf("reject settlement: %w", err)
		}
		return recordSettlementEdit(tx, ctx, id, &reviewerID, "reject", existing, &after, &reason)
	})
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

// Edit corrects an already-finalized (confirmed/rejected) settlement —
// mirrors logistics.Repository.EditHandover exactly.
func (r *Repository) Edit(ctx context.Context, id uuid.UUID, editorID uuid.UUID, req EditRequest) (*Settlement, error) {
	existing, err := r.FindByID(ctx, id)
	if err != nil {
		return nil, apperrors.NotFound("settlement")
	}
	switch existing.Status {
	case StatusConfirmed, StatusRejected:
		// finalized — editable here
	default:
		return nil, apperrors.BadRequest("only confirmed or rejected settlements can be edited")
	}

	newStatus := existing.Status
	if req.Status != nil {
		newStatus = *req.Status
	}
	newAdminNote := existing.AdminNote
	if req.AdminNote != nil {
		newAdminNote = req.AdminNote
	}
	if newStatus == StatusRejected && (newAdminNote == nil || *newAdminNote == "") && existing.RejectionReason == nil {
		return nil, apperrors.BadRequest("admin_note (rejection reason) is required when rejecting")
	}

	after := *existing
	updates := map[string]interface{}{}
	if req.Status != nil && *req.Status != existing.Status {
		updates["status"] = *req.Status
		after.Status = *req.Status
		now := time.Now().UTC()
		if *req.Status == StatusConfirmed {
			updates["reviewed_at"] = now
			after.ReviewedAt = &now
		}
	}
	if req.ActualReceived != nil && (existing.ActualReceived == nil || *existing.ActualReceived != *req.ActualReceived) {
		updates["actual_received"] = *req.ActualReceived
		after.ActualReceived = req.ActualReceived
	}
	if req.AdminNote != nil && !strPtrEqual(existing.AdminNote, req.AdminNote) {
		updates["admin_note"] = *req.AdminNote
		after.AdminNote = req.AdminNote
	}
	if len(updates) == 0 {
		return nil, apperrors.BadRequest("nothing to change")
	}

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("dispatcher_settlements").Where("id = ?", id).Updates(updates).Error; err != nil {
			return fmt.Errorf("edit settlement: %w", err)
		}
		return recordSettlementEdit(tx, ctx, id, &editorID, "edit", existing, &after, req.Reason)
	})
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

// ListEdits returns a settlement's full edit history, oldest first.
func (r *Repository) ListEdits(ctx context.Context, settlementID uuid.UUID) ([]EditRow, error) {
	var rows []EditRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			e.id,
			e.settlement_id,
			e.editor_id,
			u.full_name          AS editor_name,
			e.action,
			e.old_status::text   AS old_status,
			e.new_status::text   AS new_status,
			e.old_actual_received,
			e.new_actual_received,
			e.old_admin_note,
			e.new_admin_note,
			e.reason,
			e.created_at
		FROM dispatcher_settlement_edits e
		LEFT JOIN users u ON u.id = e.editor_id
		WHERE e.settlement_id = ?
		ORDER BY e.created_at ASC, e.id ASC
	`, settlementID).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list settlement edits: %w", err)
	}
	return rows, nil
}

// recordSettlementEdit appends one audit row describing a settlement
// change. Always called inside the same transaction as the change itself.
// created_at is set from Go's clock rather than the column's NOW() default
// — mirrors logistics.recordHandoverEdit's identical reasoning (NOW() is
// fixed for a whole transaction, so two edits inside one enclosing
// transaction would tie on created_at and lose their ordering).
func recordSettlementEdit(tx *gorm.DB, ctx context.Context, settlementID uuid.UUID, editorID *uuid.UUID, action string, before, after *Settlement, reason *string) error {
	err := tx.WithContext(ctx).Exec(`
		INSERT INTO dispatcher_settlement_edits
			(settlement_id, editor_id, action,
			 old_status, new_status,
			 old_actual_received, new_actual_received,
			 old_admin_note, new_admin_note,
			 reason, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, settlementID, editorID, action,
		before.Status, after.Status,
		before.ActualReceived, after.ActualReceived,
		before.AdminNote, after.AdminNote,
		reason, time.Now().UTC()).Error
	if err != nil {
		return fmt.Errorf("record settlement edit: %w", err)
	}
	return nil
}

func strPtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
