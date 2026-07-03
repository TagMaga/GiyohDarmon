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
	"errors"
	"fmt"
	"strings"
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
			WITH delivered_orders AS (
				SELECT DISTINCT
					o.id,
					o.total_amount,
					o.delivery_fee,
					o.courier_payout
				FROM orders o
				JOIN order_timeline tl ON tl.order_id = o.id
				WHERE o.deleted_at   IS NULL
				  AND tl.to_status   = 'delivered'
				  AND tl.created_at >= ?
				  AND tl.created_at <= ?
			),
			product_costs AS (
				SELECT
					m.reference_id AS order_id,
					COALESCE(SUM(bc.quantity * bc.unit_cost), 0) AS product_cost
				FROM inventory_movements m
				JOIN inventory_batch_consumptions bc ON bc.movement_id = m.id
				WHERE m.movement_type = 'sale'
				  AND m.reference_id IS NOT NULL
				GROUP BY m.reference_id
			)
			SELECT
				COUNT(*)                                             AS total_count,
				COALESCE(SUM(d.total_amount), 0)                     AS total_sales,
				COALESCE(SUM(d.courier_payout), 0)                   AS delivery_fees,
				COALESCE(SUM(d.delivery_fee), 0)                     AS client_delivery_fees,
				COALESCE(SUM(d.total_amount + d.delivery_fee - d.courier_payout), 0) AS net_revenue,
				COALESCE(SUM(pc.product_cost), 0)                    AS product_cost
			FROM delivered_orders d
			LEFT JOIN product_costs pc ON pc.order_id = d.id
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
			WITH handover_totals AS (
				SELECT
					COUNT(*) FILTER (WHERE status = 'confirmed')                           AS confirmed_count,
					COUNT(*) FILTER (WHERE status = 'pending')                             AS pending_count,
					COALESCE(SUM(total_collected)  FILTER (WHERE status = 'confirmed'), 0) AS cash_collected,
					COALESCE(SUM(actual_returned)  FILTER (WHERE status = 'confirmed'), 0) AS cash_returned
				FROM cash_handovers
				WHERE created_at >= ?
				  AND created_at <= ?
			),
			courier_salary AS (
				SELECT
					COALESCE(SUM(o.courier_payout), 0) AS courier_payout_kept
				FROM cash_handovers ch
				JOIN cash_handover_orders cho ON cho.handover_id = ch.id
				JOIN orders o ON o.id = cho.order_id
				WHERE ch.status = 'confirmed'
				  AND ch.created_at >= ?
				  AND ch.created_at <= ?
			)
			SELECT
				ht.confirmed_count,
				ht.pending_count,
				ht.cash_collected,
				ht.cash_returned,
				cs.courier_payout_kept
			FROM handover_totals ht
			CROSS JOIN courier_salary cs
		`, from, to, from, to).Scan(&row).Error
	if err != nil {
		return cashSummaryRow{}, fmt.Errorf("get cash summary: %w", err)
	}
	return row, nil
}

// GetExpensesSummary returns business expenses in [from, to], broken down by category.
func (r *Repository) GetExpensesSummary(
	ctx context.Context,
	from, to time.Time,
) (expensesSummaryRow, error) {
	var row expensesSummaryRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE category = 'salary'),    0) AS salaries,
			COALESCE(SUM(amount) FILTER (WHERE category = 'rent'),      0) AS rent,
			COALESCE(SUM(amount) FILTER (WHERE category = 'marketing'), 0) AS marketing,
			COALESCE(SUM(amount) FILTER (WHERE category = 'taxes'),     0) AS taxes,
			COALESCE(SUM(amount) FILTER (WHERE category = 'other'),     0) AS other_business_expenses
		FROM finance_business_expenses
		WHERE created_at >= ?
		  AND created_at <= ?
	`, from, to).Scan(&row).Error
	if err != nil {
		return expensesSummaryRow{}, fmt.Errorf("get expenses summary: %w", err)
	}
	return row, nil
}

// ─── Net profit (single source of truth, shared with internal/budget) ────────

// GetNetProfit computes company net profit for [from, to], or all-time if both
// bounds are nil. Formula: company_gross (company_revenue_earned events)
// minus product_cost (delivered orders) minus business expenses.
func (r *Repository) GetNetProfit(ctx context.Context, from, to *time.Time) (float64, error) {
	companyGross, err := r.getCompanyGross(ctx, from, to)
	if err != nil {
		return 0, fmt.Errorf("get company gross: %w", err)
	}
	productCost, err := r.getProductCostForPeriod(ctx, from, to)
	if err != nil {
		return 0, fmt.Errorf("get product cost: %w", err)
	}
	businessExpenses, err := r.getBusinessExpensesTotal(ctx, from, to)
	if err != nil {
		return 0, fmt.Errorf("get business expenses total: %w", err)
	}
	return computeNetProfit(companyGross, productCost, businessExpenses), nil
}

func (r *Repository) getCompanyGross(ctx context.Context, from, to *time.Time) (float64, error) {
	query := `SELECT COALESCE(SUM(amount), 0) FROM financial_events WHERE event_type = 'company_revenue_earned'`
	args := []interface{}{}
	if from != nil {
		query += " AND created_at >= ?"
		args = append(args, *from)
	}
	if to != nil {
		query += " AND created_at <= ?"
		args = append(args, *to)
	}
	var total float64
	err := r.db.WithContext(ctx).Raw(query, args...).Scan(&total).Error
	return total, err
}

func (r *Repository) getProductCostForPeriod(ctx context.Context, from, to *time.Time) (float64, error) {
	query := `
		WITH delivered_orders AS (
			SELECT DISTINCT o.id
			FROM orders o
			JOIN order_timeline tl ON tl.order_id = o.id
			WHERE o.deleted_at IS NULL
			  AND tl.to_status = 'delivered'`
	args := []interface{}{}
	if from != nil {
		query += " AND tl.created_at >= ?"
		args = append(args, *from)
	}
	if to != nil {
		query += " AND tl.created_at <= ?"
		args = append(args, *to)
	}
	query += `
		)
		SELECT COALESCE(SUM(bc.quantity * bc.unit_cost), 0)
		FROM inventory_movements m
		JOIN inventory_batch_consumptions bc ON bc.movement_id = m.id
		WHERE m.movement_type = 'sale'
		  AND m.reference_id IN (SELECT id FROM delivered_orders)`
	var total float64
	err := r.db.WithContext(ctx).Raw(query, args...).Scan(&total).Error
	return total, err
}

func (r *Repository) getBusinessExpensesTotal(ctx context.Context, from, to *time.Time) (float64, error) {
	query := `SELECT COALESCE(SUM(amount), 0) FROM finance_business_expenses WHERE 1=1`
	args := []interface{}{}
	if from != nil {
		query += " AND created_at >= ?"
		args = append(args, *from)
	}
	if to != nil {
		query += " AND created_at <= ?"
		args = append(args, *to)
	}
	var total float64
	err := r.db.WithContext(ctx).Raw(query, args...).Scan(&total).Error
	return total, err
}

// computeNetProfit is the single pure formula shared by GetSummary (which already
// has company_gross/product_cost/business_expenses from parallel queries in the
// same period) and GetNetProfit (used by internal/budget for the live balance).
func computeNetProfit(companyGross, productCost, businessExpenses float64) float64 {
	return roundFloat(companyGross - productCost - businessExpenses)
}

// ─── Business expenses CRUD ────────────────────────────────────────────────────

// ErrExpenseNotFound is returned when an expense id does not exist.
var ErrExpenseNotFound = errors.New("expense not found")

// AddExpense inserts a new business expense.
func (r *Repository) AddExpense(ctx context.Context, userID uuid.UUID, amount float64, note string, category ExpenseCategory) (BusinessExpense, error) {
	row := BusinessExpense{
		ID:        uuid.New(),
		Category:  category,
		Amount:    amount,
		Note:      note,
		CreatedBy: &userID,
	}
	err := r.db.WithContext(ctx).Create(&row).Error
	return row, err
}

// GetExpense returns a single business expense by id.
func (r *Repository) GetExpense(ctx context.Context, id uuid.UUID) (*BusinessExpense, error) {
	var row BusinessExpense
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrExpenseNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// UpdateExpense updates amount/note on a business expense and writes an audit
// entry. Category is intentionally not editable.
func (r *Repository) UpdateExpense(ctx context.Context, id uuid.UUID, editorID uuid.UUID, newAmount float64, newNote string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row BusinessExpense
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrExpenseNotFound
			}
			return err
		}

		edit := RecordEdit{
			ID:          uuid.New(),
			SubjectType: recordSubjectFinanceExpense,
			SubjectID:   id,
			EditedBy:    editorID,
			OldAmount:   row.Amount,
			NewAmount:   newAmount,
			OldNote:     row.Note,
			NewNote:     newNote,
		}
		if err := tx.Create(&edit).Error; err != nil {
			return err
		}

		return tx.Exec(
			`UPDATE finance_business_expenses SET amount = ?, note = ? WHERE id = ?`,
			newAmount, newNote, id,
		).Error
	})
}

// ListExpenseHistory returns the edit log for one expense, newest first.
// UNIONs legacy expense_edits rows (migrated pre-cutover) so the "Изменено N"
// badge count survives the move from company_budget_transactions.
func (r *Repository) ListExpenseHistory(ctx context.Context, expenseID uuid.UUID) ([]RecordEditRow, error) {
	var rows []RecordEditRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, subject_id, edited_by, editor_name, old_amount, new_amount, old_note, new_note, edited_at
		FROM (
			SELECT
				e.id, e.subject_id, e.edited_by,
				COALESCE(u.full_name, '') AS editor_name,
				e.old_amount, e.new_amount, e.old_note, e.new_note, e.edited_at
			FROM record_edits e
			LEFT JOIN users u ON u.id = e.edited_by
			WHERE e.subject_type = 'finance_expense' AND e.subject_id = ?
			UNION ALL
			SELECT
				ee.id, ee.expense_id, ee.edited_by,
				COALESCE(u.full_name, '') AS editor_name,
				ee.old_amount, ee.new_amount, ee.old_note, ee.new_note, ee.edited_at
			FROM expense_edits ee
			LEFT JOIN users u ON u.id = ee.edited_by
			WHERE ee.expense_id = ?
		) history
		ORDER BY edited_at DESC
	`, expenseID, expenseID).Scan(&rows).Error
	return rows, err
}

// ExpenseListParams filters the paginated business-expense list.
type ExpenseListParams struct {
	Category string
	From     *time.Time
	To       *time.Time
	Page     int
	Limit    int
}

// ListExpenses returns paginated business expenses, newest first.
func (r *Repository) ListExpenses(ctx context.Context, p ExpenseListParams) ([]BusinessExpenseRow, int64, error) {
	q := r.db.WithContext(ctx).Table("finance_business_expenses t").
		Select(`t.id, t.category::text AS category, t.amount, t.note, u.full_name AS created_by_name,
			COALESCE(ed.edit_count, 0) > 0 AS is_edited,
			COALESCE(ed.edit_count, 0) AS edit_count,
			ed.last_edited_at,
			t.created_at`).
		Joins("LEFT JOIN users u ON u.id = t.created_by").
		Joins(`LEFT JOIN (
			SELECT subject_id, COUNT(*)::int AS edit_count, MAX(edited_at) AS last_edited_at
			FROM record_edits WHERE subject_type = 'finance_expense'
			GROUP BY subject_id
		) ed ON ed.subject_id = t.id`)

	if p.Category != "" {
		q = q.Where("t.category = ?", p.Category)
	}
	if p.From != nil {
		q = q.Where("t.created_at >= ?", p.From)
	}
	if p.To != nil {
		end := p.To.Add(24*time.Hour - time.Second)
		q = q.Where("t.created_at <= ?", end)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	page := p.Page
	if page < 1 {
		page = 1
	}
	limit := p.Limit
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	var rows []BusinessExpenseRow
	err := q.Order("t.created_at DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Scan(&rows).Error
	return rows, total, err
}

// ─── Events list ──────────────────────────────────────────────────────────────

// payoutEventTypes are the synthesized event_type literals for payout rows
// (see payoutsSQL below) — keyed by payer_role.
var payoutEventTypes = map[string]string{
	"sales_team_lead": "team_lead_payout",
	"manager":         "manager_payout",
	"owner":           "owner_payout",
}

func isPayoutEventType(t string) bool {
	for _, v := range payoutEventTypes {
		if v == t {
			return true
		}
	}
	return false
}

// ListFinancialEvents returns paginated rows combining financial_events,
// finance_business_expenses, and payouts. payouts cannot live inside
// financial_events (financial_events.order_id is NOT NULL, but a payout is
// period-based, not per-order) — same reason business_expense already lives
// in its own table and gets UNIONed in here rather than being a
// financial_events row.
// Empty/nil filter values mean no filter on those fields.
func (r *Repository) ListFinancialEvents(
	ctx context.Context,
	from, to time.Time,
	eventType string,
	orderID *uuid.UUID,
	userID *uuid.UUID,
	minAmount *float64,
	maxAmount *float64,
	p pagination.Params,
) ([]FinanceEventResponse, int, error) {
	db := r.db.WithContext(ctx)

	// When filtering by event_type, include each source only if the filter
	// matches it (or the filter is empty, meaning "all sources").
	includeExpenses := eventType == "" || eventType == "business_expense"
	includePayouts := eventType == "" || isPayoutEventType(eventType)
	includeEvents := eventType == "" || (eventType != "business_expense" && !isPayoutEventType(eventType))
	// When filtering by order_id, expenses/payouts have no order — exclude them.
	if orderID != nil {
		includeExpenses = false
		includePayouts = false
	}

	args := []interface{}{from, to}
	eventsWhere := "created_at >= ? AND created_at <= ?"
	if eventType != "" && includeEvents {
		eventsWhere += " AND event_type::text = ?"
		args = append(args, eventType)
	}
	if orderID != nil {
		eventsWhere += " AND order_id = ?"
		args = append(args, *orderID)
	}
	if userID != nil {
		eventsWhere += " AND user_id = ?"
		args = append(args, *userID)
	}
	if minAmount != nil {
		eventsWhere += " AND amount >= ?"
		args = append(args, *minAmount)
	}
	if maxAmount != nil {
		eventsWhere += " AND amount <= ?"
		args = append(args, *maxAmount)
	}

	expArgs := []interface{}{from, to}
	expWhere := "t.created_at >= ? AND t.created_at <= ?"
	if userID != nil {
		expWhere += " AND t.created_by = ?"
		expArgs = append(expArgs, *userID)
	}
	if minAmount != nil {
		expWhere += " AND t.amount >= ?"
		expArgs = append(expArgs, *minAmount)
	}
	if maxAmount != nil {
		expWhere += " AND t.amount <= ?"
		expArgs = append(expArgs, *maxAmount)
	}

	payoutArgs := []interface{}{from, to}
	payoutWhere := "p.created_at >= ? AND p.created_at <= ?"
	if userID != nil {
		payoutWhere += " AND p.payee_id = ?"
		payoutArgs = append(payoutArgs, *userID)
	}
	if minAmount != nil {
		payoutWhere += " AND p.amount >= ?"
		payoutArgs = append(payoutArgs, *minAmount)
	}
	if maxAmount != nil {
		payoutWhere += " AND p.amount <= ?"
		payoutArgs = append(payoutArgs, *maxAmount)
	}
	if eventType != "" && includePayouts {
		payoutWhere += " AND (CASE p.payer_role::text WHEN 'sales_team_lead' THEN 'team_lead_payout' WHEN 'manager' THEN 'manager_payout' ELSE 'owner_payout' END) = ?"
		payoutArgs = append(payoutArgs, eventType)
	}

	eventsSQL := fmt.Sprintf(`
		SELECT
			id,
			order_id,
			user_id,
			event_type::text AS event_type,
			amount,
			NULL::text AS note,
			NULL::text AS expense_category,
			FALSE AS is_edited,
			0 AS edit_count,
			NULL::timestamptz AS last_edited_at,
			created_at,
			NULL::uuid AS payer_id,
			NULL::text AS payer_role
		FROM financial_events WHERE %s`, eventsWhere)

	expensesSQL := fmt.Sprintf(`
		SELECT
			t.id,
			NULL::uuid AS order_id,
			t.created_by AS user_id,
			'business_expense' AS event_type,
			t.amount,
			t.note,
			t.category::text AS expense_category,
			COALESCE(ed.edit_count, 0) > 0 AS is_edited,
			COALESCE(ed.edit_count, 0) AS edit_count,
			ed.last_edited_at,
			t.created_at,
			NULL::uuid AS payer_id,
			NULL::text AS payer_role
		FROM finance_business_expenses t
		LEFT JOIN (
			SELECT subject_id, COUNT(*)::int AS edit_count, MAX(edited_at) AS last_edited_at
			FROM record_edits WHERE subject_type = 'finance_expense'
			GROUP BY subject_id
		) ed ON ed.subject_id = t.id
		WHERE %s`, expWhere)

	payoutsSQL := fmt.Sprintf(`
		SELECT
			p.id,
			NULL::uuid AS order_id,
			p.payee_id AS user_id,
			CASE p.payer_role::text
				WHEN 'sales_team_lead' THEN 'team_lead_payout'
				WHEN 'manager'         THEN 'manager_payout'
				ELSE 'owner_payout'
			END AS event_type,
			p.amount,
			p.note,
			NULL::text AS expense_category,
			FALSE AS is_edited,
			0 AS edit_count,
			NULL::timestamptz AS last_edited_at,
			p.created_at,
			p.payer_id,
			p.payer_role::text AS payer_role
		FROM payouts p
		WHERE %s`, payoutWhere)

	type sourcePart struct {
		sql  string
		args []interface{}
	}
	var parts []sourcePart
	if includeEvents {
		parts = append(parts, sourcePart{eventsSQL, args})
	}
	if includeExpenses {
		parts = append(parts, sourcePart{expensesSQL, expArgs})
	}
	if includePayouts {
		parts = append(parts, sourcePart{payoutsSQL, payoutArgs})
	}
	if len(parts) == 0 {
		return []FinanceEventResponse{}, 0, nil
	}

	sqlParts := make([]string, len(parts))
	var unionArgs []interface{}
	for i, part := range parts {
		sqlParts[i] = part.sql
		unionArgs = append(unionArgs, part.args...)
	}
	joined := strings.Join(sqlParts, " UNION ALL ")
	unionSQL := fmt.Sprintf("SELECT * FROM (%s) u ORDER BY created_at DESC LIMIT ? OFFSET ?", joined)
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM (%s) u", joined)

	var total int64
	if err := db.Raw(countSQL, unionArgs...).Scan(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count finance events: %w", err)
	}

	var rows []FinanceEventResponse
	queryArgs := append(append([]interface{}{}, unionArgs...), p.Limit, p.Offset())
	if err := db.Raw(unionSQL, queryArgs...).Scan(&rows).Error; err != nil {
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

// ─── UUID helper for testing ──────────────────────────────────────────────────

// mustNewUUID returns a new random UUID. Used in tests; panics on failure.
func mustNewUUID() uuid.UUID { return uuid.New() }
