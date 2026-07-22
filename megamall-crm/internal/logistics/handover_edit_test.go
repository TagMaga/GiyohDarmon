package logistics

// handover_edit_test.go — Post-decision correction ("edit") of cash
// handovers plus the append-only edit history that backs it.
//
// Covers:
//   - UpdateHandover (pending → confirmed) records a history row with the
//     editor and old/new values.
//   - EditHandover corrects a confirmed handover's actual_returned, flips
//     status confirmed↔rejected (rejecting requires an admin note), and
//     refuses to touch pending handovers.
//   - ListHandoverEdits returns the whole trail oldest-first.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).

import (
	"context"
	"testing"
	"time"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func strPtr(s string) *string   { return &s }
func f64Ptr(f float64) *float64 { return &f }

func TestHandoverEditFlow_HistoryRecorded(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db, time.UTC)

	row, err := repo.CreateHandover(ctx, CreateHandoverReq{
		CourierID:      courier.ID,
		TotalCollected: 209,
		TotalToReturn:  209,
	})
	if err != nil {
		t.Fatalf("create handover: %v", err)
	}

	// Editing a still-pending handover must go through the regular update.
	if _, err := repo.EditHandover(ctx, row.ID, owner.ID, EditHandoverReq{ActualReturned: f64Ptr(100)}); err == nil {
		t.Fatalf("expected EditHandover on a pending handover to be rejected")
	}

	// Initial decision: confirm with a 9-short amount (the -9 case).
	row, err = repo.UpdateHandover(ctx, row.ID, owner.ID, UpdateHandoverReq{
		Status:         strPtr("confirmed"),
		ActualReturned: f64Ptr(200),
	})
	if err != nil {
		t.Fatalf("confirm handover: %v", err)
	}
	if row.Status != "confirmed" || row.ActualReturned == nil || *row.ActualReturned != 200 {
		t.Fatalf("unexpected state after confirm: status=%s actual=%v", row.Status, row.ActualReturned)
	}
	if row.ConfirmedAt == nil {
		t.Fatalf("confirmed_at not set on confirm")
	}

	// Correction: the courier later paid the missing 9, owner edits 200 → 209.
	row, err = repo.EditHandover(ctx, row.ID, owner.ID, EditHandoverReq{
		ActualReturned: f64Ptr(209),
		Reason:         strPtr("курьер доплатил разницу"),
	})
	if err != nil {
		t.Fatalf("edit handover: %v", err)
	}
	if row.Status != "confirmed" || *row.ActualReturned != 209 {
		t.Fatalf("unexpected state after edit: status=%s actual=%v", row.Status, row.ActualReturned)
	}

	// Rejecting via edit requires an admin note…
	if _, err := repo.EditHandover(ctx, row.ID, owner.ID, EditHandoverReq{Status: strPtr("rejected")}); err == nil {
		t.Fatalf("expected reject-without-note to be refused")
	}
	// …and works with one, clearing confirmed_at.
	row, err = repo.EditHandover(ctx, row.ID, owner.ID, EditHandoverReq{
		Status:    strPtr("rejected"),
		AdminNote: strPtr("сумма не поступила"),
	})
	if err != nil {
		t.Fatalf("edit → rejected: %v", err)
	}
	if row.Status != "rejected" || row.ConfirmedAt != nil {
		t.Fatalf("unexpected state after reject edit: status=%s confirmed_at=%v", row.Status, row.ConfirmedAt)
	}

	// A no-op edit is refused.
	if _, err := repo.EditHandover(ctx, row.ID, owner.ID, EditHandoverReq{ActualReturned: f64Ptr(209)}); err == nil {
		t.Fatalf("expected a no-change edit to be refused")
	}

	edits, err := repo.ListHandoverEdits(ctx, row.ID)
	if err != nil {
		t.Fatalf("list edits: %v", err)
	}
	if len(edits) != 3 {
		t.Fatalf("expected 3 history rows (confirm, edit, edit), got %d", len(edits))
	}

	confirmEdit := edits[0]
	if confirmEdit.Action != "confirm" {
		t.Fatalf("first history row action = %q, want confirm", confirmEdit.Action)
	}
	if confirmEdit.OldStatus == nil || *confirmEdit.OldStatus != "pending" ||
		confirmEdit.NewStatus == nil || *confirmEdit.NewStatus != "confirmed" {
		t.Fatalf("confirm row status transition wrong: %v → %v", confirmEdit.OldStatus, confirmEdit.NewStatus)
	}
	if confirmEdit.EditorID == nil || *confirmEdit.EditorID != owner.ID {
		t.Fatalf("confirm row editor = %v, want owner %s", confirmEdit.EditorID, owner.ID)
	}
	if confirmEdit.EditorName == nil || *confirmEdit.EditorName == "" {
		t.Fatalf("confirm row editor_name not resolved")
	}

	amountEdit := edits[1]
	if amountEdit.Action != "edit" {
		t.Fatalf("second history row action = %q, want edit", amountEdit.Action)
	}
	if amountEdit.OldActualReturned == nil || *amountEdit.OldActualReturned != 200 ||
		amountEdit.NewActualReturned == nil || *amountEdit.NewActualReturned != 209 {
		t.Fatalf("amount edit old/new wrong: %v → %v", amountEdit.OldActualReturned, amountEdit.NewActualReturned)
	}
	if amountEdit.Reason == nil || *amountEdit.Reason != "курьер доплатил разницу" {
		t.Fatalf("amount edit reason not recorded: %v", amountEdit.Reason)
	}

	rejectEdit := edits[2]
	if rejectEdit.NewStatus == nil || *rejectEdit.NewStatus != "rejected" {
		t.Fatalf("third history row new_status = %v, want rejected", rejectEdit.NewStatus)
	}
	if rejectEdit.NewAdminNote == nil || *rejectEdit.NewAdminNote != "сумма не поступила" {
		t.Fatalf("third history row admin note not recorded: %v", rejectEdit.NewAdminNote)
	}
}
