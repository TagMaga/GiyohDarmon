package payouts

// repository_test.go — DB-backed tests for the payout-batch atomicity and
// cross-batch concurrency fix (CreateBatchIdempotent's lockPayees +
// revalidate). Requires a real Postgres DB via TEST_ADMIN_DSN (see
// internal/testutil) — never an in-memory database, since the fix depends on
// real Postgres transaction/advisory-lock semantics.
//
// The pure aggregation/validation logic (validatePayoutItems,
// aggregatePayoutAmounts) is covered without a database in service_test.go —
// this file only covers what genuinely needs Postgres: atomicity and the
// cross-transaction lock.
//
// Run with: TEST_ADMIN_DSN=... go test ./internal/payouts/ -run TestPayouts -v

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/validator"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) { os.Exit(testutil.Main(m)) }

func newRepo(db *gorm.DB) *Repository { return NewRepository(db) }

func samplePeriod() (time.Time, time.Time) {
	from := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	return from, to
}

func newPayoutRow(payerID, payeeID uuid.UUID, amount float64, from, to time.Time) *Payout {
	return &Payout{
		ID:          uuid.New(),
		PayeeID:     payeeID,
		PayeeRole:   "seller",
		PayerID:     payerID,
		PayerRole:   "sales_team_lead",
		Amount:      amount,
		PeriodStart: from,
		PeriodEnd:   to,
		Status:      "paid",
	}
}

// ─── DTO-level validation (zero/negative amount, empty batch) ─────────────────

func TestPayouts_Request_ZeroAmountRejected(t *testing.T) {
	req := CreatePayoutsRequest{
		Items:          []CreatePayoutItem{{PayeeID: uuid.New(), Amount: 0}},
		PeriodStart:    "2026-07-01",
		PeriodEnd:      "2026-07-31",
		IdempotencyKey: "test-key-00000001",
	}
	if err := validator.Validate(req); err == nil {
		t.Fatal("expected validation error for zero amount")
	}
}

func TestPayouts_Request_NegativeAmountRejected(t *testing.T) {
	req := CreatePayoutsRequest{
		Items:          []CreatePayoutItem{{PayeeID: uuid.New(), Amount: -10}},
		PeriodStart:    "2026-07-01",
		PeriodEnd:      "2026-07-31",
		IdempotencyKey: "test-key-00000002",
	}
	if err := validator.Validate(req); err == nil {
		t.Fatal("expected validation error for negative amount")
	}
}

func TestPayouts_Request_EmptyBatchRejected(t *testing.T) {
	req := CreatePayoutsRequest{
		Items:          []CreatePayoutItem{},
		PeriodStart:    "2026-07-01",
		PeriodEnd:      "2026-07-31",
		IdempotencyKey: "test-key-00000003",
	}
	if err := validator.Validate(req); err == nil {
		t.Fatal("expected validation error for empty batch")
	}
}

// ─── Atomicity (rolled-back per-test transaction — no cross-test state) ────────

func TestPayouts_CreateBatchIdempotent_NormalBatchSucceeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	payer := testutil.CreateUser(t, db, "sales_team_lead")
	payee := testutil.CreateUser(t, db, "seller")
	from, to := samplePeriod()

	rows := []*Payout{newPayoutRow(payer.ID, payee.ID, 250, from, to)}
	batch := &PayoutBatch{ID: uuid.New(), PayerID: payer.ID, IdempotencyKey: "normal-batch-key"}

	if err := repo.CreateBatchIdempotent(ctx, batch, rows, nil); err != nil {
		t.Fatalf("CreateBatchIdempotent: %v", err)
	}

	stored, err := repo.ListByBatchID(ctx, batch.ID)
	if err != nil {
		t.Fatalf("ListByBatchID: %v", err)
	}
	if len(stored) != 1 || stored[0].Amount != 250 {
		t.Fatalf("stored rows = %+v, want one row of 250", stored)
	}
}

// TestPayouts_CreateBatchIdempotent_MidBatchFailureRollsBackEverything proves
// the whole batch is one transaction: forcing the second row to violate a
// constraint (duplicate primary key) must leave neither the batch row nor
// the first (otherwise-valid) payout row behind.
func TestPayouts_CreateBatchIdempotent_MidBatchFailureRollsBackEverything(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	payer := testutil.CreateUser(t, db, "sales_team_lead")
	payeeA := testutil.CreateUser(t, db, "seller")
	payeeB := testutil.CreateUser(t, db, "seller")
	from, to := samplePeriod()

	goodRow := newPayoutRow(payer.ID, payeeA.ID, 100, from, to)
	badRow := newPayoutRow(payer.ID, payeeB.ID, 100, from, to)
	badRow.ID = goodRow.ID // force a primary-key collision on the second insert

	batch := &PayoutBatch{ID: uuid.New(), PayerID: payer.ID, IdempotencyKey: "mid-batch-failure-key"}
	err := repo.CreateBatchIdempotent(ctx, batch, []*Payout{goodRow, badRow}, nil)
	if err == nil {
		t.Fatal("expected an error from the colliding second row")
	}

	var batchCount int64
	if err := db.Table("payout_batches").Where("id = ?", batch.ID).Count(&batchCount).Error; err != nil {
		t.Fatalf("count batch: %v", err)
	}
	if batchCount != 0 {
		t.Fatalf("payout_batches row persisted despite mid-batch failure, want 0")
	}

	var payoutCount int64
	if err := db.Table("payouts").Where("id = ?", goodRow.ID).Count(&payoutCount).Error; err != nil {
		t.Fatalf("count payout: %v", err)
	}
	if payoutCount != 0 {
		t.Fatalf("first (valid) payout row persisted despite the batch failing, want 0 — batch must be all-or-nothing")
	}
}

// TestPayouts_CreateBatchIdempotent_RevalidateRejectionRollsBackEverything
// proves a revalidate rejection (the fresh, lock-protected re-check) rolls
// back the whole attempt — no batch row, no payout rows.
func TestPayouts_CreateBatchIdempotent_RevalidateRejectionRollsBackEverything(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := newRepo(db)
	ctx := context.Background()
	payer := testutil.CreateUser(t, db, "sales_team_lead")
	payee := testutil.CreateUser(t, db, "seller")
	from, to := samplePeriod()

	rows := []*Payout{newPayoutRow(payer.ID, payee.ID, 999, from, to)}
	batch := &PayoutBatch{ID: uuid.New(), PayerID: payer.ID, IdempotencyKey: "revalidate-rejects-key"}

	rejectAlways := func(tx *gorm.DB) error {
		return apperrors.BadRequest("simulated: exceeds fresh remaining balance")
	}

	err := repo.CreateBatchIdempotent(ctx, batch, rows, rejectAlways)
	if err == nil {
		t.Fatal("expected revalidate's error to abort the batch")
	}
	if _, ok := apperrors.AsAppError(err); !ok {
		t.Fatalf("expected a *apperrors.AppError to propagate through the transaction, got %T: %v", err, err)
	}

	var batchCount, payoutCount int64
	db.Table("payout_batches").Where("id = ?", batch.ID).Count(&batchCount)
	db.Table("payouts").Where("id = ?", rows[0].ID).Count(&payoutCount)
	if batchCount != 0 || payoutCount != 0 {
		t.Fatalf("batchCount=%d payoutCount=%d, want 0/0 — revalidate rejection must roll back everything", batchCount, payoutCount)
	}
}

// ─── Cross-batch concurrency (real commits — uses testutil.DB(t) directly,
// like internal/budget's concurrency tests, since two goroutines each need
// their own real, independently-committing transaction to actually race) ─────

// TestPayouts_ConcurrentBatches_CannotDoubleSpendSamePayee fires two
// different payout batches (different idempotency keys — not a retry of the
// same request) for the SAME payee at the same time, each requesting an
// amount that individually fits a cap but together would exceed it. Both
// batches' revalidate closures read the payee's already-paid total fresh,
// under the payee's advisory lock — exactly like CreatePayouts wires it in
// production. Exactly one must win.
func TestPayouts_ConcurrentBatches_CannotDoubleSpendSamePayee(t *testing.T) {
	db := testutil.DB(t)
	repo := newRepo(db)
	ctx := context.Background()
	payer := testutil.CreateUser(t, db, "sales_team_lead")
	payee := testutil.CreateUser(t, db, "seller")
	from, to := samplePeriod()

	const cap = 1000.0
	makeRevalidate := func(amount float64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			paid, err := repo.SumPaidForPayeeTx(ctx, tx, payer.ID, payee.ID, from, to)
			if err != nil {
				return apperrors.Internal(err)
			}
			// Widen the window between "read fresh paid total" and "commit"
			// deliberately, so this test reliably proves the lock actually
			// serializes the two goroutines instead of merely passing by
			// scheduling luck. With the lock in place this only adds
			// latency (the second goroutine is already blocked before it
			// gets here); with the lock removed this reliably reproduces
			// the double-spend the fix closes.
			time.Sleep(50 * time.Millisecond)
			if paid+amount > cap {
				return apperrors.BadRequest("exceeds cap")
			}
			return nil
		}
	}

	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		rows := []*Payout{newPayoutRow(payer.ID, payee.ID, 700, from, to)}
		batch := &PayoutBatch{ID: uuid.New(), PayerID: payer.ID, IdempotencyKey: "race-batch-A"}
		results[0] = repo.CreateBatchIdempotent(ctx, batch, rows, makeRevalidate(700))
	}()
	go func() {
		defer wg.Done()
		rows := []*Payout{newPayoutRow(payer.ID, payee.ID, 700, from, to)}
		batch := &PayoutBatch{ID: uuid.New(), PayerID: payer.ID, IdempotencyKey: "race-batch-B"}
		results[1] = repo.CreateBatchIdempotent(ctx, batch, rows, makeRevalidate(700))
	}()
	wg.Wait()

	succeeded, failed := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.As(err, new(*apperrors.AppError)):
			failed++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if succeeded != 1 || failed != 1 {
		t.Fatalf("succeeded=%d failed=%d, want exactly 1 success and 1 rejection (700+700=1400 > cap 1000)", succeeded, failed)
	}

	total, err := repo.SumPaidForPayeeTx(ctx, db, payer.ID, payee.ID, from, to)
	if err != nil {
		t.Fatalf("SumPaidForPayeeTx: %v", err)
	}
	if total != 700 {
		t.Fatalf("total paid to payee = %.2f, want exactly 700 (only the winning batch applied)", total)
	}
}
