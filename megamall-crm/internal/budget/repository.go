package budget

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/finance"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
var ErrInvalidAmount = errors.New("amount must be greater than zero")

// budgetLedgerLockKey is the pg_advisory_xact_lock key that serializes every
// AddWithdrawal against every other one. There is no single "balance row" to
// SELECT ... FOR UPDATE — CurrentBalance is a live aggregate over
// company_budget_transactions plus Finance's net profit (see manualNet /
// CurrentBalance above) — so a row lock has nothing to attach to. This
// mirrors internal/courier/repository.go's LockCourierForHandover, whose doc
// comment explains the same problem for cash handovers: a session-scoped
// advisory lock, held for the duration of the transaction, blocks a second
// concurrent withdrawal until the first COMMITs, so the second withdrawal's
// balance re-read (taken after acquiring the lock) is guaranteed to observe
// the first one's effect under READ COMMITTED.
const budgetLedgerLockKey = "company_budget_ledger"

// AddWithdrawal inserts an owner_withdrawal row. Returns ErrInsufficientBalance
// if amount exceeds the current (live) company balance, and ErrInvalidAmount
// if amount is not strictly positive.
//
// The whole check-then-insert sequence runs inside one DB transaction guarded
// by an advisory lock, so two concurrent withdrawals can never both validate
// against the same balance and jointly overspend it (see budgetLedgerLockKey).
// If tx is non-nil, the lock+read+insert run against the caller's existing
// transaction (the lock is still (re-)acquired — Postgres advisory locks are
// reentrant/stacking within a session, so this is safe); otherwise a new
// transaction is opened for the whole operation.
func (r *Repository) AddWithdrawal(ctx context.Context, tx *gorm.DB, userID uuid.UUID, amount float64, note string) (float64, error) {
	if amount <= 0 {
		return 0, ErrInvalidAmount
	}

	if tx != nil {
		return r.addWithdrawalLocked(ctx, tx, userID, amount, note)
	}

	var newBalance float64
	err := r.db.WithContext(ctx).Transaction(func(txn *gorm.DB) error {
		var err error
		newBalance, err = r.addWithdrawalLocked(ctx, txn, userID, amount, note)
		return err
	})
	if err != nil {
		return 0, err
	}
	return newBalance, nil
}

// addWithdrawalLocked does the actual locked check-then-insert. txn must be a
// real transaction handle (not r.db) so the advisory lock and the insert
// share one Postgres transaction/session and the lock is released exactly at
// COMMIT/ROLLBACK.
func (r *Repository) addWithdrawalLocked(ctx context.Context, txn *gorm.DB, userID uuid.UUID, amount float64, note string) (float64, error) {
	if err := txn.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(?))", budgetLedgerLockKey).Error; err != nil {
		return 0, fmt.Errorf("lock company budget ledger: %w", err)
	}

	// Re-read balance only after the lock is held — any concurrent
	// withdrawal that started before us has, by now, either committed (and
	// its effect is visible here) or is still blocked waiting for us.
	manual, err := manualNet(ctx, txn, nil, nil)
	if err != nil {
		return 0, err
	}
	netProfit, err := r.financeRepo.GetNetProfit(ctx, nil, nil)
	if err != nil {
		return 0, err
	}
	balance := roundMoney(manual + netProfit)
	if amount > balance {
		return 0, ErrInsufficientBalance
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
	if err := txn.WithContext(ctx).Create(&row).Error; err != nil {
		return 0, err
	}
	return roundMoney(newManual + netProfit), nil
}

var ErrTransactionNotFound = errors.New("transaction not found")

// signedEffect returns a transaction's signed contribution to the manual
// (top-up/withdrawal) running total: positive for a top-up, negative for a
// withdrawal. Used to compute the net effect of an amount edit without
// re-deriving the whole ledger.
func signedEffect(t TransactionType, amount float64) float64 {
	if t == TypeOwnerWithdrawal {
		return -amount
	}
	return amount
}

// UpdateTransaction updates amount/note on a top-up or withdrawal row, writes
// an audit entry, and recalculates every balance_after snapshot. Only
// manual_income/owner_withdrawal rows are editable — legacy manual_expense/
// finance_profit rows (system-generated, pre-dating the Finance/Budget
// split) are excluded by the WHERE clause below and return
// ErrTransactionNotFound, exactly like a missing row; there is no supported
// way to edit them and none is added here.
//
// The whole read-validate-write sequence runs inside one transaction guarded
// by the same budgetLedgerLockKey advisory lock AddWithdrawal uses, so this
// can never race against a concurrent AddWithdrawal/AddIncome/another edit to
// jointly produce a negative balance — see budgetLedgerLockKey's doc comment.
// The edit is rejected outright (no partial effect, no clamping) if the
// resulting company balance would be negative.
func (r *Repository) UpdateTransaction(ctx context.Context, id uuid.UUID, editorID uuid.UUID, newAmount float64, newNote string) error {
	if newAmount <= 0 || math.IsNaN(newAmount) || math.IsInf(newAmount, 0) {
		return ErrInvalidAmount
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(?))", budgetLedgerLockKey).Error; err != nil {
			return fmt.Errorf("lock company budget ledger: %w", err)
		}

		var row Transaction
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND transaction_type IN ('manual_income','owner_withdrawal')", id).
			First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTransactionNotFound
			}
			return err
		}

		// Re-read the ledger only after the lock is held (see AddWithdrawal),
		// then compute the resulting balance as if this one row's amount were
		// newAmount instead of its current value — no other row changes.
		manual, err := manualNet(ctx, tx, nil, nil)
		if err != nil {
			return err
		}
		netProfit, err := r.financeRepo.GetNetProfit(ctx, nil, nil)
		if err != nil {
			return err
		}
		adjustedManual := manual - signedEffect(row.TransactionType, row.Amount) + signedEffect(row.TransactionType, newAmount)
		resultingBalance := roundMoney(adjustedManual + netProfit)
		if resultingBalance < 0 {
			return ErrInsufficientBalance
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
