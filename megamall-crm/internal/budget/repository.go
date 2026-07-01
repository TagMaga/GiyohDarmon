package budget

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/finance"
	"gorm.io/gorm"
)

const maxSearchLen = 100

// Repository handles Company Budget's own ledger (top-ups, owner withdrawals)
// and defers to financeRepo for the "accumulated net profit from Finance" term
// in the balance formula — Budget never stores or duplicates Finance's profit
// history, it reads it live.
type Repository struct {
	db          *gorm.DB
	loc         *time.Location
	financeRepo *finance.Repository
}

func NewRepository(db *gorm.DB, loc *time.Location, financeRepo *finance.Repository) *Repository {
	if loc == nil {
		loc = time.UTC
	}
	return &Repository{db: db, loc: loc, financeRepo: financeRepo}
}

func roundMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

// manualNet computes SUM(manual_income) - SUM(owner_withdrawal) for the given db
// handle, optionally bounded by [from, to] (nil = unbounded on that side).
func manualNet(ctx context.Context, db *gorm.DB, from, to *time.Time) (float64, error) {
	query := `
		SELECT COALESCE(SUM(CASE
			WHEN transaction_type = 'manual_income'    THEN amount
			WHEN transaction_type = 'owner_withdrawal' THEN -amount
			ELSE 0
		END), 0)
		FROM company_budget_transactions
		WHERE transaction_type IN ('manual_income', 'owner_withdrawal')`
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
	err := db.WithContext(ctx).Raw(query, args...).Scan(&total).Error
	return total, err
}

// CurrentBalance is the all-time company balance: manual top-ups/withdrawals
// plus the live accumulated net profit from Finance. Never affected by any
// date filter.
func (r *Repository) CurrentBalance(ctx context.Context) (float64, error) {
	manual, err := manualNet(ctx, r.db, nil, nil)
	if err != nil {
		return 0, err
	}
	netProfit, err := r.financeRepo.GetNetProfit(ctx, nil, nil)
	if err != nil {
		return 0, err
	}
	return roundMoney(manual + netProfit), nil
}

// Summary returns the dashboard aggregate. from/to scope the period-based KPIs
// (profit_from_finance, manual_top_ups, owner_withdrawals, total_received);
// balance and today_change are always computed independently of the filter.
func (r *Repository) Summary(ctx context.Context, from, to *time.Time) (SummaryRow, error) {
	balance, err := r.CurrentBalance(ctx)
	if err != nil {
		return SummaryRow{}, err
	}

	periodManual, err := manualNet(ctx, r.db, from, to)
	if err != nil {
		return SummaryRow{}, err
	}
	// periodManual nets top-ups and withdrawals together; split them back out
	// with two more targeted sums so they can be shown as separate KPI cards.
	manualTopUps, err := r.sumByType(ctx, TypeManualIncome, from, to)
	if err != nil {
		return SummaryRow{}, err
	}
	ownerWithdrawals, err := r.sumByType(ctx, TypeOwnerWithdrawal, from, to)
	if err != nil {
		return SummaryRow{}, err
	}
	profitFromFinance, err := r.financeRepo.GetNetProfit(ctx, from, to)
	if err != nil {
		return SummaryRow{}, err
	}

	now := time.Now().In(r.loc)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, r.loc)
	todayEnd := todayStart.Add(24*time.Hour - time.Nanosecond)
	todayManual, err := manualNet(ctx, r.db, &todayStart, &todayEnd)
	if err != nil {
		return SummaryRow{}, err
	}
	todayProfit, err := r.financeRepo.GetNetProfit(ctx, &todayStart, &todayEnd)
	if err != nil {
		return SummaryRow{}, err
	}

	_ = periodManual // kept for clarity/documentation; superseded by the split sums below

	return SummaryRow{
		Balance:           balance,
		ProfitFromFinance: profitFromFinance,
		ManualTopUps:      manualTopUps,
		OwnerWithdrawals:  ownerWithdrawals,
		TotalReceived:     roundMoney(profitFromFinance + manualTopUps),
		TodayChange:       roundMoney(todayManual + todayProfit),
	}, nil
}

func (r *Repository) sumByType(ctx context.Context, t TransactionType, from, to *time.Time) (float64, error) {
	query := `SELECT COALESCE(SUM(amount), 0) FROM company_budget_transactions WHERE transaction_type = ?`
	args := []interface{}{string(t)}
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
	return roundMoney(total), err
}

type ListParams struct {
	TransactionType string
	Search          string
	CreatedBy       *uuid.UUID
	From            *time.Time
	To              *time.Time
	Page            int
	Limit           int
}

// List returns only manual_income (top-up) and owner_withdrawal rows — legacy
// manual_expense/finance_profit rows are excluded from every Budget view (they
// stay in the table as an untouched audit artifact, never deleted).
func (r *Repository) List(ctx context.Context, p ListParams) ([]TransactionRow, int64, error) {
	q := r.db.WithContext(ctx).Table("company_budget_transactions t").
		Select(`t.id, t.transaction_type, t.amount, t.note, u.full_name AS created_by_name,
			COALESCE(ed.edit_count, 0) > 0 AS is_edited,
			COALESCE(ed.edit_count, 0) AS edit_count,
			ed.last_edited_at,
			t.balance_after, t.created_at`).
		Joins("LEFT JOIN users u ON u.id = t.created_by").
		Joins(`LEFT JOIN (
			SELECT subject_id, COUNT(*)::int AS edit_count, MAX(edited_at) AS last_edited_at
			FROM record_edits WHERE subject_type = 'budget_transaction'
			GROUP BY subject_id
		) ed ON ed.subject_id = t.id`).
		Where("t.transaction_type IN ('manual_income','owner_withdrawal')")

	if p.TransactionType != "" {
		q = q.Where("t.transaction_type = ?", p.TransactionType)
	}
	if p.CreatedBy != nil {
		q = q.Where("t.created_by = ?", *p.CreatedBy)
	}
	if p.Search != "" {
		s := p.Search
		if len(s) > maxSearchLen {
			s = s[:maxSearchLen]
		}
		q = q.Where("t.note ILIKE ?", "%"+s+"%")
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
	var rows []TransactionRow
	err := q.Order("t.created_at DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Scan(&rows).Error
	return rows, total, err
}

// AddIncome inserts a manual_income (top-up) row and returns the resulting balance.
func (r *Repository) AddIncome(ctx context.Context, tx *gorm.DB, userID uuid.UUID, amount float64, note string) (float64, error) {
	db := r.db
	if tx != nil {
		db = tx
	}
	manual, err := manualNet(ctx, db, nil, nil)
	if err != nil {
		return 0, err
	}
	newManual := roundMoney(manual + amount)
	row := Transaction{
		ID:              uuid.New(),
		TransactionType: TypeManualIncome,
		Amount:          amount,
		Note:            note,
		CreatedBy:       &userID,
		BalanceAfter:    newManual,
	}
	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		return 0, err
	}
	return r.CurrentBalance(ctx)
}

var ErrInsufficientBalance = errors.New("insufficient balance")

// AddWithdrawal inserts an owner_withdrawal row. Returns ErrInsufficientBalance
// if amount exceeds the current (live) company balance.
func (r *Repository) AddWithdrawal(ctx context.Context, tx *gorm.DB, userID uuid.UUID, amount float64, note string) (float64, error) {
	db := r.db
	if tx != nil {
		db = tx
	}
	balance, err := r.CurrentBalance(ctx)
	if err != nil {
		return 0, err
	}
	if amount > balance {
		return 0, ErrInsufficientBalance
	}

	manual, err := manualNet(ctx, db, nil, nil)
	if err != nil {
		return 0, err
	}
	newManual := roundMoney(manual - amount)
	row := Transaction{
		ID:              uuid.New(),
		TransactionType: TypeOwnerWithdrawal,
		Amount:          amount,
		Note:            note,
		CreatedBy:       &userID,
		BalanceAfter:    newManual,
	}
	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		return 0, err
	}
	return r.CurrentBalance(ctx)
}

// GetTransaction returns a single manual_income/owner_withdrawal row by id.
func (r *Repository) GetTransaction(ctx context.Context, id uuid.UUID) (*Transaction, error) {
	var row Transaction
	err := r.db.WithContext(ctx).
		Where("id = ? AND transaction_type IN ('manual_income','owner_withdrawal')", id).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTransactionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

var ErrTransactionNotFound = errors.New("transaction not found")

// UpdateTransaction updates amount/note on a top-up or withdrawal row, writes an
// audit entry, and recalculates balance_after. Only amount and note are editable.
func (r *Repository) UpdateTransaction(ctx context.Context, id uuid.UUID, editorID uuid.UUID, newAmount float64, newNote string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Transaction
		if err := tx.Where("id = ? AND transaction_type IN ('manual_income','owner_withdrawal')", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTransactionNotFound
			}
			return err
		}

		if err := tx.Exec(
			`INSERT INTO record_edits (id, subject_type, subject_id, edited_by, old_amount, new_amount, old_note, new_note)
			 VALUES (?, 'budget_transaction', ?, ?, ?, ?, ?, ?)`,
			uuid.New(), id, editorID, row.Amount, newAmount, row.Note, newNote,
		).Error; err != nil {
			return err
		}

		if err := tx.Exec(
			`UPDATE company_budget_transactions SET amount = ?, note = ? WHERE id = ?`,
			newAmount, newNote, id,
		).Error; err != nil {
			return err
		}

		// Changing amount shifts every balance_after snapshot from this point forward
		// (balance_after is a stored running total of manual top-ups/withdrawals only —
		// live Finance profit is layered on top at read time, never stored per-row).
		return recalcBalanceAfter(tx)
	})
}

// recalcBalanceAfter recomputes balance_after for every manual_income/owner_withdrawal
// row from the running total, in chronological order. Legacy manual_expense/
// finance_profit rows are left untouched by the running sum (contribute 0) since
// they're no longer part of the visible ledger.
func recalcBalanceAfter(tx *gorm.DB) error {
	return tx.Exec(`
		UPDATE company_budget_transactions t
		SET balance_after = o.running_balance
		FROM (
			SELECT id,
				SUM(CASE
					WHEN transaction_type = 'manual_income'    THEN amount
					WHEN transaction_type = 'owner_withdrawal' THEN -amount
					ELSE 0
				END) OVER (ORDER BY created_at, id) AS running_balance
			FROM company_budget_transactions
		) o
		WHERE t.id = o.id
	`).Error
}

// ListTransactionHistory returns the edit log for one transaction, newest first.
func (r *Repository) ListTransactionHistory(ctx context.Context, id uuid.UUID) ([]finance.RecordEditRow, error) {
	var rows []finance.RecordEditRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			e.id, e.subject_id, e.edited_by,
			COALESCE(u.full_name, '') AS editor_name,
			e.old_amount, e.new_amount,
			e.old_note, e.new_note,
			e.edited_at
		FROM record_edits e
		LEFT JOIN users u ON u.id = e.edited_by
		WHERE e.subject_type = 'budget_transaction' AND e.subject_id = ?
		ORDER BY e.edited_at DESC
	`, id).Scan(&rows).Error
	return rows, err
}

// ListCreators returns the distinct users who created a top-up/withdrawal, for
// the "filter by owner" dropdown.
func (r *Repository) ListCreators(ctx context.Context) ([]CreatorRow, error) {
	var rows []CreatorRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT u.id, u.full_name
		FROM company_budget_transactions t
		JOIN users u ON u.id = t.created_by
		WHERE t.transaction_type IN ('manual_income','owner_withdrawal')
		ORDER BY u.full_name
	`).Scan(&rows).Error
	return rows, err
}
