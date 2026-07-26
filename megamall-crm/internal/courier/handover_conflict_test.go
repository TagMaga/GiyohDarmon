package courier_test

// handover_conflict_test.go — DB-backed tests for the cash-handover TOCTOU
// fix (Blocker: dispatcher confirms while owner rejects, or vice versa, on
// the same handover — both used to read "pending", both pass validation,
// last write silently wins). internal/courier's ConfirmHandover/
// ConfirmTransaction/RejectHandover and internal/logistics' UpdateHandover/
// EditHandover all mutate the same cash_handovers row; this file proves both
// entry points now share one concurrency-safe mechanism
// (courier.LockHandoverForUpdate + courier.GuardedHandoverUpdate).
//
// Deliberately package courier_test (external): it imports both
// internal/courier and internal/logistics — logistics already imports
// courier in production code, so a same-package (internal) test file here
// importing logistics would risk confusion about the dependency direction;
// an external test package makes the cross-module nature of these tests
// explicit and cannot create an import cycle (it isn't linked into either
// package).
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/courier/ -run TestHandoverConflict -v

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/logistics"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

func newCourierService(db *gorm.DB) *courier.Service {
	return courier.NewService(courier.NewRepository(db), nil, activity.NewLogger(activity.NewRepository(db)), db)
}

func newLogisticsRepo(db *gorm.DB) *logistics.Repository {
	return logistics.NewRepository(db, nil)
}

// seedPendingHandover inserts a fresh pending handover directly (bypassing
// the order-submission flow, which isn't what these tests are about) and
// returns its ID.
func seedPendingHandover(t *testing.T, db *gorm.DB, courierID uuid.UUID, toReturn float64) uuid.UUID {
	t.Helper()
	h := &courier.CashHandover{
		ID:                uuid.New(),
		CourierID:         courierID,
		TotalCollected:    toReturn,
		TotalDeliveryFees: 0,
		TotalToReturn:     toReturn,
		Status:            courier.HandoverStatusPending,
	}
	if err := db.Create(h).Error; err != nil {
		t.Fatalf("seed pending handover: %v", err)
	}
	return h.ID
}

func handoverStatus(t *testing.T, db *gorm.DB, id uuid.UUID) string {
	t.Helper()
	var status string
	if err := db.Table("cash_handovers").Select("status").Where("id = ?", id).Scan(&status).Error; err != nil {
		t.Fatalf("read handover status: %v", err)
	}
	return status
}

// ─── Basic behavior (rolled-back tx per test) ───────────────────────────────

func TestHandoverConflict_NormalConfirmSucceeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	h, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100})
	if err != nil {
		t.Fatalf("ConfirmHandover: %v", err)
	}
	if h.Status != courier.HandoverStatusConfirmed {
		t.Fatalf("status = %s, want confirmed", h.Status)
	}
}

func TestHandoverConflict_NormalRejectSucceeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	h, err := svc.RejectHandover(ctx, dispatcherID, id, courier.RejectHandoverRequest{Comment: "wrong amount"})
	if err != nil {
		t.Fatalf("RejectHandover: %v", err)
	}
	if h.Status != courier.HandoverStatusRejected {
		t.Fatalf("status = %s, want rejected", h.Status)
	}
}

// TestHandoverConflict_ConfirmingTwice_OnlySucceedsOnce is the sequential
// (non-racing) retry/idempotency-safety case: confirming an
// already-confirmed handover must be rejected outright, not silently
// re-applied or double-counted.
func TestHandoverConflict_ConfirmingTwice_OnlySucceedsOnce(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	if _, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100}); err != nil {
		t.Fatalf("first confirm: %v", err)
	}
	_, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100})
	if err == nil {
		t.Fatal("expected the second confirm to be rejected")
	}
	if _, ok := apperrors.AsAppError(err); !ok {
		t.Fatalf("expected a client-facing AppError, got %T: %v", err, err)
	}
	if handoverStatus(t, db, id) != "confirmed" {
		t.Fatalf("status changed after the rejected second confirm")
	}
}

func TestHandoverConflict_RejectingTwice_OnlySucceedsOnce(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	if _, err := svc.RejectHandover(ctx, dispatcherID, id, courier.RejectHandoverRequest{Comment: "bad"}); err != nil {
		t.Fatalf("first reject: %v", err)
	}
	_, err := svc.RejectHandover(ctx, dispatcherID, id, courier.RejectHandoverRequest{Comment: "bad again"})
	if err == nil {
		t.Fatal("expected the second reject to be rejected")
	}
	if handoverStatus(t, db, id) != "rejected" {
		t.Fatalf("status changed after the rejected second reject")
	}
}

// TestHandoverConflict_FailedConfirmLeavesHandoverAndAuditUnchanged proves a
// rejected attempt (wrong starting status) has zero side effects: no status
// change, no cash_handover_edits row.
func TestHandoverConflict_FailedConfirmLeavesHandoverAndAuditUnchanged(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	if _, err := svc.RejectHandover(ctx, dispatcherID, id, courier.RejectHandoverRequest{Comment: "bad"}); err != nil {
		t.Fatalf("reject: %v", err)
	}
	var editsBefore int64
	db.Table("cash_handover_edits").Where("handover_id = ?", id).Count(&editsBefore)

	if _, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100}); err == nil {
		t.Fatal("expected confirm on an already-rejected handover to fail")
	}

	if handoverStatus(t, db, id) != "rejected" {
		t.Fatalf("status changed despite the confirm attempt failing")
	}
	var editsAfter int64
	db.Table("cash_handover_edits").Where("handover_id = ?", id).Count(&editsAfter)
	if editsAfter != editsBefore {
		t.Fatalf("cash_handover_edits count changed (%d -> %d) despite the failed confirm", editsBefore, editsAfter)
	}
}

// TestHandoverConflict_UpdateHandoverRejectsAlreadyConfirmed proves the
// ordinary logistics admin path (UpdateHandover) cannot touch an
// already-finalized handover — only the separate, explicitly-gated
// EditHandover correction workflow can (see the next test).
func TestHandoverConflict_UpdateHandoverRejectsAlreadyConfirmed(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	lrepo := newLogisticsRepo(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	if _, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100}); err != nil {
		t.Fatalf("confirm: %v", err)
	}

	status := "rejected"
	note := "trying to flip it via the ordinary path"
	_, err := lrepo.UpdateHandover(ctx, id, owner.ID, logistics.UpdateHandoverReq{Status: &status, AdminNote: &note})
	if err == nil {
		t.Fatal("expected UpdateHandover to reject an already-confirmed handover")
	}
	if handoverStatus(t, db, id) != "confirmed" {
		t.Fatalf("status changed despite UpdateHandover being rejected")
	}
}

// TestHandoverConflict_EditHandoverCanCorrectAConfirmedOne documents the
// intentional exception: EditHandover is the explicit, separately-gated
// "we made a mistake" workflow and — per existing product behavior — may
// still change an already-confirmed handover's outcome, with every change
// recorded in cash_handover_edits (reason required by convention, though
// not enforced by this DTO). This must keep working after the concurrency
// fix, not be collateral damage from it.
func TestHandoverConflict_EditHandoverCanCorrectAConfirmedOne(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	lrepo := newLogisticsRepo(db)
	id := seedPendingHandover(t, db, c.ID, 100)

	if _, err := svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 100}); err != nil {
		t.Fatalf("confirm: %v", err)
	}

	status := "rejected"
	note := "correcting a mistaken confirmation"
	reason := "wrong courier was confirmed"
	row, err := lrepo.EditHandover(ctx, id, owner.ID, logistics.EditHandoverReq{Status: &status, AdminNote: &note, Reason: &reason})
	if err != nil {
		t.Fatalf("EditHandover: %v", err)
	}
	if row.Status != "rejected" {
		t.Fatalf("status = %s, want rejected", row.Status)
	}
}

// ─── Cross-module concurrency (real commits via testutil.DB(t)) ───────────────

// TestHandoverConflict_ConcurrentConfirmVsUpdateReject is the literal
// reproduction of the reported bug: a dispatcher confirms via
// internal/courier while, at the same time, an owner rejects the SAME
// pending handover via internal/logistics' UpdateHandover. Exactly one must
// win; the loser must get a client-visible conflict, never a false success;
// and the final stored status must match exactly one of the two outcomes
// (never a torn/mixed state, never both audit trails claiming success).
func TestHandoverConflict_ConcurrentConfirmVsUpdateReject(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	lrepo := newLogisticsRepo(db)
	id := seedPendingHandover(t, db, c.ID, 250)

	var wg sync.WaitGroup
	var confirmErr, rejectErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, confirmErr = svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 250})
	}()
	go func() {
		defer wg.Done()
		status := "rejected"
		note := "amount looks wrong"
		_, rejectErr = lrepo.UpdateHandover(ctx, id, owner.ID, logistics.UpdateHandoverReq{Status: &status, AdminNote: &note})
	}()
	wg.Wait()

	succeeded, failed := 0, 0
	for _, err := range []error{confirmErr, rejectErr} {
		switch {
		case err == nil:
			succeeded++
		case errors.As(err, new(*apperrors.AppError)):
			failed++
		default:
			t.Fatalf("unexpected error type: %v", err)
		}
	}
	if succeeded != 1 || failed != 1 {
		t.Fatalf("succeeded=%d failed=%d, want exactly 1 success and 1 conflict (confirmErr=%v rejectErr=%v)", succeeded, failed, confirmErr, rejectErr)
	}

	final := handoverStatus(t, db, id)
	if confirmErr == nil && final != "confirmed" {
		t.Fatalf("confirm won but final status = %s, want confirmed", final)
	}
	if rejectErr == nil && final != "rejected" {
		t.Fatalf("reject won but final status = %s, want rejected", final)
	}

	// Exactly one audit trail should show a completed decision: the
	// logistics-side cash_handover_edits row exists only if UpdateHandover's
	// guarded write actually committed (i.e. it won).
	var editCount int64
	db.Table("cash_handover_edits").Where("handover_id = ?", id).Count(&editCount)
	if rejectErr == nil && editCount != 1 {
		t.Fatalf("reject won but cash_handover_edits count = %d, want 1", editCount)
	}
	if rejectErr != nil && editCount != 0 {
		t.Fatalf("reject lost but cash_handover_edits count = %d, want 0 (no partial audit row from the loser)", editCount)
	}
}

// TestHandoverConflict_ConcurrentConfirmVsReject races two same-module
// (courier) actions against each other on the same handover — the
// single-module race the fix must also close, not just the cross-module one.
func TestHandoverConflict_ConcurrentConfirmVsReject(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 300)

	var wg sync.WaitGroup
	var confirmErr, rejectErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, confirmErr = svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 300})
	}()
	go func() {
		defer wg.Done()
		_, rejectErr = svc.RejectHandover(ctx, dispatcherID, id, courier.RejectHandoverRequest{Comment: "disputed by owner"})
	}()
	wg.Wait()

	succeeded, failed := 0, 0
	for _, err := range []error{confirmErr, rejectErr} {
		switch {
		case err == nil:
			succeeded++
		case errors.As(err, new(*apperrors.AppError)):
			failed++
		default:
			t.Fatalf("unexpected error type: %v", err)
		}
	}
	if succeeded != 1 || failed != 1 {
		t.Fatalf("succeeded=%d failed=%d, want exactly 1 success and 1 conflict", succeeded, failed)
	}

	final := handoverStatus(t, db, id)
	if confirmErr == nil && final != "confirmed" {
		t.Fatalf("confirm won but final status = %s", final)
	}
	if rejectErr == nil && final != "rejected" {
		t.Fatalf("reject won but final status = %s", final)
	}
}

// TestHandoverConflict_LoserGetsConflictNotInternalError specifically checks
// the loser's error is a client-visible Conflict (409-mapped), never a
// generic/internal error — "never return success for a clobbered action"
// extends to "never return an opaque 500 either."
func TestHandoverConflict_LoserGetsConflictNotInternalError(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 150)

	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			defer wg.Done()
			_, results[i] = svc.ConfirmHandover(ctx, dispatcherID, id, courier.ConfirmHandoverRequest{ActualReturned: 150})
		}(i)
	}
	wg.Wait()

	var loserErr error
	succeeded := 0
	for _, err := range results {
		if err == nil {
			succeeded++
		} else {
			loserErr = err
		}
	}
	if succeeded != 1 {
		t.Fatalf("succeeded=%d, want exactly 1 (double confirm of the same pending handover)", succeeded)
	}
	appErr, ok := apperrors.AsAppError(loserErr)
	if !ok {
		t.Fatalf("loser error is not a client-facing AppError: %T: %v", loserErr, loserErr)
	}
	if appErr.Code != apperrors.CodeConflict && appErr.Code != apperrors.CodeBadRequest {
		t.Fatalf("loser error code = %s, want CONFLICT or BAD_REQUEST (either is a proper 4xx, never a 500)", appErr.Code)
	}
}

func TestHandoverConflict_ConfirmTransactionSucceedsAndSecondCallConflicts(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	dispatcherID := testutil.CreateUser(t, db, users.RoleDispatcher).ID
	svc := newCourierService(db)
	id := seedPendingHandover(t, db, c.ID, 175)

	h, err := svc.ConfirmTransaction(ctx, dispatcherID, id)
	if err != nil {
		t.Fatalf("ConfirmTransaction: %v", err)
	}
	if h.Status != courier.HandoverStatusConfirmed {
		t.Fatalf("status = %s, want confirmed", h.Status)
	}
	if h.ActualReturned == nil || *h.ActualReturned != 175 {
		t.Fatalf("actual_returned = %v, want 175 (falls back to total_to_return)", h.ActualReturned)
	}

	_, err = svc.ConfirmTransaction(ctx, dispatcherID, id)
	if err == nil {
		t.Fatal("expected the second ConfirmTransaction call to be rejected")
	}
	if handoverStatus(t, db, id) != "confirmed" {
		t.Fatalf("status changed after the rejected second call")
	}
}
