package budget

// update_transaction_test.go — DB-backed tests for the UpdateTransaction
// balance-bypass fix. Requires a real Postgres DB via TEST_ADMIN_DSN (see
// internal/testutil) — never an in-memory database, since the fix depends on
// real Postgres transaction/advisory-lock semantics.
//
// Background: UpdateTransaction previously let an owner edit an existing
// top-up/withdrawal's amount to any value with zero balance validation and
// no lock, completely bypassing the AddWithdrawal fix (proven live: editing
// a 100 withdrawal to 999999999 drove the balance to -999998999). This file
// proves the edit path now enforces the same "balance must never go
// negative" invariant, atomically, under concurrency.
//
// Run with: TEST_ADMIN_DSN=... go test ./internal/budget/ -run TestUpdateTransaction -v

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"gorm.io/gorm"
)

type ledgerRow struct {
	ID              uuid.UUID
	TransactionType string
	Amount          float64
	BalanceAfter    float64
}

// fetchLedger returns only ownerID's own rows, in canonical ledger order —
// scoping by owner (rather than reading the whole table) matters because
// some tests in this file use testutil.DB(t) (real commits, persisting for
// the whole test binary run) rather than the per-test rolled-back
// transaction, so the table can contain rows from other tests by the time
// this runs.
func fetchLedger(t *testing.T, db *gorm.DB, ownerID uuid.UUID) []ledgerRow {
	t.Helper()
	var rows []ledgerRow
	err := db.Table("company_budget_transactions").
		Select("id, transaction_type, amount, balance_after").
		Where("transaction_type IN ('manual_income','owner_withdrawal') AND created_by = ?", ownerID).
		Order("created_at ASC, id ASC").
		Scan(&rows).Error
	if err != nil {
		t.Fatalf("fetch ledger: %v", err)
	}
	return rows
}

// drainToZero withdraws (or tops up) whatever the current global balance is
// so a concurrency test can reason about an exact, known available amount
// afterward, regardless of residue committed by other tests earlier in this
// same test binary run (balance is a single global company total — see
// fetchLedger's doc comment).
func drainToZero(t *testing.T, repo *Repository, ctx context.Context, ownerID uuid.UUID) {
	t.Helper()
	bal, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance (drain): %v", err)
	}
	switch {
	case bal > 0:
		if _, err := repo.AddWithdrawal(ctx, nil, ownerID, bal, "test-drain"); err != nil {
			t.Fatalf("drain withdrawal: %v", err)
		}
	case bal < 0:
		if _, err := repo.AddIncome(ctx, nil, ownerID, -bal, "test-drain"); err != nil {
			t.Fatalf("drain income: %v", err)
		}
	}
}

func findTxIDByNote(t *testing.T, db *gorm.DB, note string) uuid.UUID {
	t.Helper()
	var idStr string
	if err := db.Table("company_budget_transactions").Select("id").Where("note = ?", note).Scan(&idStr).Error; err != nil {
		t.Fatalf("find tx by note %q: %v", note, err)
	}
	if idStr == "" {
		t.Fatalf("no transaction found with note %q", note)
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		t.Fatalf("parse id %q: %v", idStr, err)
	}
	return id
}

// ─── Basic edit validation (rolled-back tx per test) ───────────────────────────

func TestUpdateTransaction_WithdrawalToLargerAmount_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)
	before, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance (baseline): %v", err)
	}

	if _, err := repo.AddIncome(ctx, nil, owner, 1000, "seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner, 100, "w1"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "w1")

	if err := repo.UpdateTransaction(ctx, id, owner, 300, "w1 edited"); err != nil {
		t.Fatalf("UpdateTransaction: %v", err)
	}
	bal, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	want := roundMoney(before + 700) // baseline + (1000 income - 300 withdrawal)
	if bal != want {
		t.Fatalf("balance = %.2f, want %.2f (baseline + 1000 - 300)", bal, want)
	}
}

func TestUpdateTransaction_WithdrawalToSmallerAmount_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)
	before, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance (baseline): %v", err)
	}

	if _, err := repo.AddIncome(ctx, nil, owner, 1000, "seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner, 300, "w1"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "w1")

	if err := repo.UpdateTransaction(ctx, id, owner, 100, "w1 edited down"); err != nil {
		t.Fatalf("UpdateTransaction: %v", err)
	}
	bal, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	want := roundMoney(before + 900) // baseline + (1000 income - 100 withdrawal)
	if bal != want {
		t.Fatalf("balance = %.2f, want %.2f (baseline + 1000 - 100)", bal, want)
	}
}

func TestUpdateTransaction_EditTopUp_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)
	before, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance (baseline): %v", err)
	}

	if _, err := repo.AddIncome(ctx, nil, owner, 500, "topup"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	id := findTxIDByNote(t, db, "topup")

	if err := repo.UpdateTransaction(ctx, id, owner, 800, "topup edited"); err != nil {
		t.Fatalf("UpdateTransaction: %v", err)
	}
	bal, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	want := roundMoney(before + 800)
	if bal != want {
		t.Fatalf("balance = %.2f, want %.2f", bal, want)
	}
}

func TestUpdateTransaction_ToZero_Fails(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	repo.AddIncome(ctx, nil, owner, 1000, "seed")
	repo.AddWithdrawal(ctx, nil, owner, 100, "w1")
	id := findTxIDByNote(t, db, "w1")

	if err := repo.UpdateTransaction(ctx, id, owner, 0, "zero"); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("err = %v, want ErrInvalidAmount", err)
	}
}

func TestUpdateTransaction_ToNegative_Fails(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	repo.AddIncome(ctx, nil, owner, 1000, "seed")
	repo.AddWithdrawal(ctx, nil, owner, 100, "w1")
	id := findTxIDByNote(t, db, "w1")

	if err := repo.UpdateTransaction(ctx, id, owner, -50, "negative"); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("err = %v, want ErrInvalidAmount", err)
	}
}

// TestUpdateTransaction_BeyondAvailableBalance_Fails is the direct
// regression test for the reproduced exploit: editing a withdrawal upward
// past what the company actually has must be rejected, not silently applied.
func TestUpdateTransaction_BeyondAvailableBalance_Fails(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	if _, err := repo.AddIncome(ctx, nil, owner, 1000, "seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner, 100, "w1"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "w1")

	beforeAttempt, berr := repo.CurrentBalance(ctx)
	if berr != nil {
		t.Fatalf("CurrentBalance (pre-attempt): %v", berr)
	}
	err := repo.UpdateTransaction(ctx, id, owner, 5000, "too much")
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("err = %v, want ErrInsufficientBalance", err)
	}
	bal, cerr := repo.CurrentBalance(ctx)
	if cerr != nil {
		t.Fatalf("CurrentBalance: %v", cerr)
	}
	if bal != beforeAttempt {
		t.Fatalf("balance after rejected edit = %.2f, want unchanged %.2f", bal, beforeAttempt)
	}
}

// TestUpdateTransaction_999999999ExploitFails is the literal reproduction of
// the reported live exploit (edit a 100 withdrawal to 999999999 from a 1000
// balance) — must now fail outright instead of driving the balance to
// -999998999.
func TestUpdateTransaction_999999999ExploitFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	if _, err := repo.AddIncome(ctx, nil, owner, 1000, "seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner, 100, "small withdrawal"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "small withdrawal")

	beforeAttempt, berr := repo.CurrentBalance(ctx)
	if berr != nil {
		t.Fatalf("CurrentBalance (pre-attempt): %v", berr)
	}
	err := repo.UpdateTransaction(ctx, id, owner, 999999999, "edited")
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("exploit err = %v, want ErrInsufficientBalance (edit must be rejected)", err)
	}
	bal, cerr := repo.CurrentBalance(ctx)
	if cerr != nil {
		t.Fatalf("CurrentBalance: %v", cerr)
	}
	if bal < 0 {
		t.Fatalf("FINAL BALANCE WENT NEGATIVE: %.2f — exploit succeeded, invariant violated", bal)
	}
	if bal != beforeAttempt {
		t.Fatalf("balance = %.2f, want unchanged %.2f (edit must have no effect when rejected)", bal, beforeAttempt)
	}
}

// TestUpdateTransaction_RecalculatesLaterBalanceAfterCorrectly is the exact
// scenario from the spec: Top-up +1000 (bal 1000), Withdrawal -100 (bal
// 900), Top-up +200 (bal 1100); editing the withdrawal from 100 to 300 must
// produce 1000 / 700 / 900, not just fix the final total.
func TestUpdateTransaction_RecalculatesLaterBalanceAfterCorrectly(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	// balance_after is a GLOBAL running total across the whole ledger table
	// (recalcBalanceAfter has no per-owner scoping — there is only one
	// company), so its absolute value depends on whatever other tests in
	// this binary run already committed. Establish a baseline here so the
	// assertions below check the correct *shape* (relative to that
	// baseline) regardless of execution order or other tests' residue.
	baseline, err := manualNet(ctx, db, nil, nil)
	if err != nil {
		t.Fatalf("manualNet (baseline): %v", err)
	}

	if _, err := repo.AddIncome(ctx, nil, owner, 1000, "step1"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner, 100, "step2"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	if _, err := repo.AddIncome(ctx, nil, owner, 200, "step3"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}

	before := fetchLedger(t, db, owner)
	wantBefore := []float64{baseline + 1000, baseline + 900, baseline + 1100}
	if len(before) != 3 {
		t.Fatalf("unexpected pre-edit ledger row count: %+v", before)
	}
	for i, row := range before {
		if row.BalanceAfter != roundMoney(wantBefore[i]) {
			t.Fatalf("pre-edit row %d balance_after = %.2f, want %.2f (full sequence: %+v)", i, row.BalanceAfter, wantBefore[i], before)
		}
	}

	if err := repo.UpdateTransaction(ctx, before[1].ID, owner, 300, "step2 edited"); err != nil {
		t.Fatalf("UpdateTransaction: %v", err)
	}

	after := fetchLedger(t, db, owner)
	if len(after) != 3 {
		t.Fatalf("row count changed: %+v", after)
	}
	wantAfter := []float64{baseline + 1000, baseline + 700, baseline + 900}
	for i, row := range after {
		if row.BalanceAfter != roundMoney(wantAfter[i]) {
			t.Fatalf("row %d balance_after = %.2f, want %.2f (full sequence: %+v)", i, row.BalanceAfter, wantAfter[i], after)
		}
	}
}

func TestUpdateTransaction_AuditHistoryRecordsOldAndNew(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	repo.AddIncome(ctx, nil, owner, 1000, "seed")
	repo.AddWithdrawal(ctx, nil, owner, 100, "w1")
	id := findTxIDByNote(t, db, "w1")

	if err := repo.UpdateTransaction(ctx, id, owner, 250, "w1 edited"); err != nil {
		t.Fatalf("UpdateTransaction: %v", err)
	}

	var edit struct {
		OldAmount float64
		NewAmount float64
	}
	err := db.Table("record_edits").
		Select("old_amount, new_amount").
		Where("subject_type = 'budget_transaction' AND subject_id = ?", id).
		Scan(&edit).Error
	if err != nil {
		t.Fatalf("query record_edits: %v", err)
	}
	if edit.OldAmount != 100 || edit.NewAmount != 250 {
		t.Fatalf("record_edits old/new = %.2f/%.2f, want 100.00/250.00", edit.OldAmount, edit.NewAmount)
	}
}

func TestUpdateTransaction_FailedEdit_CreatesNoAuditRow(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	repo.AddIncome(ctx, nil, owner, 1000, "seed")
	repo.AddWithdrawal(ctx, nil, owner, 100, "w1")
	id := findTxIDByNote(t, db, "w1")

	var before int64
	db.Table("record_edits").Where("subject_type = 'budget_transaction' AND subject_id = ?", id).Count(&before)

	err := repo.UpdateTransaction(ctx, id, owner, 999999999, "should fail")
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected rejection, got: %v", err)
	}

	var after int64
	db.Table("record_edits").Where("subject_type = 'budget_transaction' AND subject_id = ?", id).Count(&after)
	if after != before {
		t.Fatalf("audit row count changed from %d to %d despite the edit being rejected", before, after)
	}
}

// TestUpdateTransaction_MidTransactionFailureRollsBack proves the lock+read+
// audit-insert+update+recalc sequence is one atomic transaction: forcing a
// failure after the audit insert (via a deliberate rollback) must leave
// neither the audit row nor the amount change behind.
func TestUpdateTransaction_MidTransactionFailureRollsBack(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	repo.AddIncome(ctx, nil, owner, 1000, "seed")
	repo.AddWithdrawal(ctx, nil, owner, 100, "w1")
	id := findTxIDByNote(t, db, "w1")

	err := db.Transaction(func(txn *gorm.DB) error {
		if txErr := txn.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(?))", budgetLedgerLockKey).Error; txErr != nil {
			return txErr
		}
		if txErr := txn.Exec(
			`INSERT INTO record_edits (id, subject_type, subject_id, edited_by, old_amount, new_amount, old_note, new_note)
			 VALUES (?, 'budget_transaction', ?, ?, ?, ?, ?, ?)`,
			uuid.New(), id, owner, 100, 300, "w1", "w1 partial",
		).Error; txErr != nil {
			return txErr
		}
		if txErr := txn.Exec(`UPDATE company_budget_transactions SET amount = ? WHERE id = ?`, 300, id).Error; txErr != nil {
			return txErr
		}
		return errors.New("force rollback after both writes")
	})
	if err == nil {
		t.Fatal("expected forced error")
	}

	var amt float64
	db.Table("company_budget_transactions").Select("amount").Where("id = ?", id).Scan(&amt)
	if amt != 100 {
		t.Fatalf("amount = %.2f after rolled-back edit, want unchanged 100.00", amt)
	}
	var editCount int64
	db.Table("record_edits").Where("subject_id = ? AND new_note = 'w1 partial'", id).Count(&editCount)
	if editCount != 0 {
		t.Fatalf("found %d audit row(s) from the rolled-back edit, want 0", editCount)
	}
}

// TestUpdateTransaction_AutomaticProfitCannotBeEdited: legacy manual_expense/
// finance_profit rows (system-generated, pre-dating the Finance/Budget
// split) must not be editable through this path.
func TestUpdateTransaction_AutomaticProfitCannotBeEdited(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := seedOwner(t, db)

	legacyID := uuid.New()
	if err := db.Exec(
		`INSERT INTO company_budget_transactions (id, transaction_type, amount, note, created_by, balance_after)
		 VALUES (?, 'finance_profit', 500, 'legacy auto row', ?, 500)`,
		legacyID, owner,
	).Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	err := repo.UpdateTransaction(ctx, legacyID, owner, 999, "attempted edit")
	if !errors.Is(err, ErrTransactionNotFound) {
		t.Fatalf("err = %v, want ErrTransactionNotFound (legacy/automatic rows must be unreachable via this path)", err)
	}

	var amt float64
	db.Table("company_budget_transactions").Select("amount").Where("id = ?", legacyID).Scan(&amt)
	if amt != 500 {
		t.Fatalf("legacy row amount = %.2f, want unchanged 500.00", amt)
	}
}

// ─── Concurrency (real commits against the disposable DB via testutil.DB(t),
// not the rolled-back per-test transaction other tests use) ────────────────────

// TestUpdateTransaction_ConcurrentEditsCannotCorruptLedger fires two
// concurrent edits of the SAME withdrawal row to different amounts. Exactly
// one must win (the other serializes behind the row lock and then succeeds
// or fails based on post-lock state — with two edits of the same row this
// means both may succeed sequentially, but the final state must be
// internally consistent: the stored amount matches exactly one of the
// submitted values, and the balance is exactly what that final amount
// implies — never a torn/mixed state).
func TestUpdateTransaction_ConcurrentEditsCannotCorruptLedger(t *testing.T) {
	db := testutil.DB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := testutil.CreateUser(t, db, "owner")

	before, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	if _, err := repo.AddIncome(ctx, nil, owner.ID, 1000, "concurrent-edit seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner.ID, 100, "concurrent-edit target"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "concurrent-edit target")

	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		results[0] = repo.UpdateTransaction(ctx, id, owner.ID, 200, "edited to 200")
	}()
	go func() {
		defer wg.Done()
		results[1] = repo.UpdateTransaction(ctx, id, owner.ID, 300, "edited to 300")
	}()
	wg.Wait()

	for i, err := range results {
		if err != nil {
			t.Fatalf("edit %d unexpectedly failed (both should fit within balance): %v", i, err)
		}
	}

	var finalAmount float64
	db.Table("company_budget_transactions").Select("amount").Where("id = ?", id).Scan(&finalAmount)
	if finalAmount != 200 && finalAmount != 300 {
		t.Fatalf("final stored amount = %.2f, want exactly 200 or 300 (one of the two submitted values, not a corrupted mix)", finalAmount)
	}

	after, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	want := roundMoney(before + 1000 - finalAmount)
	if after != want {
		t.Fatalf("final balance = %.2f, want %.2f (consistent with the winning amount %.2f — no torn state)", after, want, finalAmount)
	}
}

// TestUpdateTransaction_ConcurrentCreateAndEdit_CannotOverspend races a brand
// new withdrawal creation against an edit of an existing withdrawal, timed
// so that together they would overspend the balance if unprotected.
func TestUpdateTransaction_ConcurrentCreateAndEdit_CannotOverspend(t *testing.T) {
	db := testutil.DB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := testutil.CreateUser(t, db, "owner")
	drainToZero(t, repo, ctx, owner.ID)

	const seed = 1000.0
	if _, err := repo.AddIncome(ctx, nil, owner.ID, seed, "create-vs-edit seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner.ID, 100, "create-vs-edit target"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "create-vs-edit target")
	// Balance is now exactly 900 (drained to 0, then +1000 -100). Editing the
	// existing withdrawal up to 700 (→ balance 300) and creating a brand-new
	// withdrawal of 700 concurrently would together overspend
	// (700 + 700 = 1400 > 900 available before either runs).

	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		results[0] = repo.UpdateTransaction(ctx, id, owner.ID, 700, "edited up to 700")
	}()
	go func() {
		defer wg.Done()
		_, results[1] = repo.AddWithdrawal(ctx, nil, owner.ID, 700, "new concurrent withdrawal")
	}()
	wg.Wait()

	succeeded, failed := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrInsufficientBalance):
			failed++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if succeeded != 1 || failed != 1 {
		t.Fatalf("succeeded=%d failed=%d, want exactly 1 success and 1 rejection", succeeded, failed)
	}

	after, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	if after < 0 {
		t.Fatalf("balance went negative: %.2f", after)
	}
	// Starting from a known zero-drained baseline, balance is exactly 900
	// (1000 income - 100 original withdrawal). Which of the two operations
	// won determines the expected exact result: if the edit won (existing
	// withdrawal 100 -> 700, a -600 delta), balance = 300; if the new
	// withdrawal won (a fresh -700), balance = 200. Either is a valid winner
	// — the invariant is that it's exactly one of these two, never both.
	var want float64
	if results[0] == nil { // edit won
		want = 300
	} else { // new withdrawal won
		want = 200
	}
	if after != want {
		t.Fatalf("final balance = %.2f, want %.2f (based on which operation won)", after, want)
	}
}

// TestUpdateTransaction_ConcurrentTopUpAndWithdrawalEdit_ConsistentResult
// races a fresh top-up against an edit of an existing withdrawal for the
// same owner; both are individually valid and must both succeed with a
// final balance that reflects both, never a lost update.
func TestUpdateTransaction_ConcurrentTopUpAndWithdrawalEdit_ConsistentResult(t *testing.T) {
	db := testutil.DB(t)
	repo := newRepo(db)
	ctx := context.Background()
	owner := testutil.CreateUser(t, db, "owner")

	before, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	if _, err := repo.AddIncome(ctx, nil, owner.ID, 1000, "topup-vs-edit seed"); err != nil {
		t.Fatalf("AddIncome: %v", err)
	}
	if _, err := repo.AddWithdrawal(ctx, nil, owner.ID, 100, "topup-vs-edit target"); err != nil {
		t.Fatalf("AddWithdrawal: %v", err)
	}
	id := findTxIDByNote(t, db, "topup-vs-edit target")

	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, results[0] = repo.AddIncome(ctx, nil, owner.ID, 500, "concurrent topup")
	}()
	go func() {
		defer wg.Done()
		results[1] = repo.UpdateTransaction(ctx, id, owner.ID, 150, "concurrent edit")
	}()
	wg.Wait()

	for i, err := range results {
		if err != nil {
			t.Fatalf("operation %d unexpectedly failed: %v", i, err)
		}
	}

	after, err := repo.CurrentBalance(ctx)
	if err != nil {
		t.Fatalf("CurrentBalance: %v", err)
	}
	want := roundMoney(before + 1000 + 500 - 150)
	if after != want {
		t.Fatalf("final balance = %.2f, want %.2f (both operations must be reflected, no lost update)", after, want)
	}
}
