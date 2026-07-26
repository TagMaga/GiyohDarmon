package courier

// handover_txn.go — Shared, concurrency-safe primitives for mutating
// cash_handovers, used by BOTH this package's confirm/reject flow
// (service.go: ConfirmHandover, ConfirmTransaction, RejectHandover) and
// internal/logistics' owner/admin update-and-edit flow
// (logistics/repository.go: UpdateHandover, EditHandover), which operate on
// the exact same table.
//
// Previously, every one of those functions did: a plain (unlocked) read, a
// status check in Go, then a separate UPDATE with no WHERE-status guard.
// Two concurrent actions on the same handover (e.g. a dispatcher confirming
// it while an owner rejects it via the logistics admin path) could both
// read "pending", both pass validation, and both write — last write wins
// silently, with no indication either side that its outcome was clobbered.
//
// The fix has two parts, used together everywhere a handover is mutated:
//  1. LockHandoverForUpdate — SELECT ... FOR UPDATE inside the caller's
//     transaction, so a second concurrent locked read blocks until the
//     first transaction commits or rolls back.
//  2. GuardedHandoverUpdate — the actual UPDATE carries its own
//     WHERE status IN (fromStatuses) condition and checks RowsAffected==1.
//     This is what makes the loser of a race detectable and rejected
//     (ErrHandoverConflict) instead of silently overwritten, even if some
//     future caller forgets step 1 — the guard alone is still correct,
//     just serialized later (blocked by the row lock until commit, then
//     failing the WHERE condition against the new state).
//
// Kept in this package (rather than a new shared package) because
// CashHandover is this package's model; internal/logistics imports these two
// functions directly (no import cycle: courier does not import logistics).

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrHandoverConflict means the handover's status no longer matched what the
// caller validated against — a concurrent operation from ANY entry point
// (courier confirm/reject, or the logistics update/edit path) already
// changed it first. Callers must surface this as a client-visible conflict
// (HTTP 409), never as success.
var ErrHandoverConflict = errors.New("handover has already been processed or changed")

// LockHandoverForUpdate reads a handover row with SELECT ... FOR UPDATE
// inside tx. Every handover state-change entry point must lock the row this
// way before validating its current status against the allowed set for that
// operation — a plain SELECT lets two concurrent requests both observe the
// same pre-change status and both proceed, which is exactly the TOCTOU this
// exists to close.
func LockHandoverForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*CashHandover, error) {
	var h CashHandover
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Orders").
		Where("id = ?", id).
		First(&h).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.NotFound("handover")
	}
	if err != nil {
		return nil, fmt.Errorf("lock handover: %w", err)
	}
	return &h, nil
}

// GuardedHandoverUpdate applies updates to cash_handovers only if the row's
// current status is still one of fromStatuses. Must be called inside the
// same transaction as LockHandoverForUpdate, after validating the locked
// row's status is in fromStatuses — the WHERE clause here re-affirms that
// exact condition at the moment of the write itself, so if RowsAffected is
// 0 the row's status changed between the lock and this call (should not
// happen given the lock, but is checked regardless as defense in depth) and
// ErrHandoverConflict is returned instead of silently reporting success.
func GuardedHandoverUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID, fromStatuses []string, updates map[string]interface{}) error {
	res := tx.WithContext(ctx).
		Table("cash_handovers").
		Where("id = ? AND status IN ?", id, fromStatuses).
		Updates(updates)
	if res.Error != nil {
		return fmt.Errorf("guarded handover update: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return ErrHandoverConflict
	}
	return nil
}
