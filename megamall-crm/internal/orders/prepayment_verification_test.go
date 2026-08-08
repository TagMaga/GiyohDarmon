package orders

// prepayment_verification_test.go — Service.VerifyPrepayment must stamp
// verified_by/verified_at on the individual order_prepayments row(s), not
// just the order-level prepayment_status/prepayment_verified_at columns.
// Without that, the dispatcher drawer's per-record badge ("Ожидает" vs
// "✓ Подтверждена", driven by OrderPrepayment.VerifiedAt) stays stuck on
// "Ожидает" forever even after the order-level status flips to verified.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/orders/ -v -run TestVerifyPrepayment

import (
	"context"
	"testing"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func TestVerifyPrepayment_StampsPrepaymentRecordVerifiedAt(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	seller := createTeamSeller(t, db)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	created, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{Amount: 25})
	if err != nil {
		t.Fatalf("AddPrepayment: %v", err)
	}
	if created.VerifiedAt != nil {
		t.Fatalf("a freshly-created prepayment must start unverified, got VerifiedAt=%v", created.VerifiedAt)
	}

	updatedOrder, err := svc.VerifyPrepayment(context.Background(), dispatcher.ID, "dispatcher", order.ID, VerifyPrepaymentRequest{})
	if err != nil {
		t.Fatalf("VerifyPrepayment: %v", err)
	}
	if updatedOrder.PrepaymentStatus != PrepaymentStatusVerified {
		t.Fatalf("order.PrepaymentStatus = %q, want %q", updatedOrder.PrepaymentStatus, PrepaymentStatusVerified)
	}

	prepayments, err := svc.ListPrepayments(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("ListPrepayments: %v", err)
	}
	if len(prepayments) != 1 {
		t.Fatalf("expected 1 prepayment record, got %d", len(prepayments))
	}
	p := prepayments[0]
	if p.VerifiedAt == nil {
		t.Error("expected the order_prepayments row's VerifiedAt to be stamped after VerifyPrepayment, got nil")
	}
	if p.VerifiedBy == nil || *p.VerifiedBy != dispatcher.ID {
		t.Errorf("expected VerifiedBy = %v, got %v", dispatcher.ID, p.VerifiedBy)
	}
}

// A second prepayment added after the first was already verified should be
// left untouched by that earlier verification — only ever-pending records
// are marked, so an out-of-band write can't silently backdate one that a
// dispatcher hasn't looked at yet. It becomes "Ожидает" again at the
// order level (AddPrepayment resets prepayment_status to
// pending_verification) and gets its own VerifiedAt on the next verify.
func TestVerifyPrepayment_DoesNotTouchAlreadyVerifiedRecords(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	seller := createTeamSeller(t, db)
	order := createOrderForMediaTest(t, db, svc, seller.ID)
	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	if _, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{Amount: 25}); err != nil {
		t.Fatalf("AddPrepayment #1: %v", err)
	}
	if _, err := svc.VerifyPrepayment(context.Background(), dispatcher.ID, "dispatcher", order.ID, VerifyPrepaymentRequest{}); err != nil {
		t.Fatalf("VerifyPrepayment #1: %v", err)
	}

	before, err := svc.ListPrepayments(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("ListPrepayments (before): %v", err)
	}
	if len(before) != 1 || before[0].VerifiedAt == nil {
		t.Fatalf("expected 1 verified record before the second prepayment, got %+v", before)
	}
	firstVerifiedAt := *before[0].VerifiedAt

	if _, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{Amount: 15}); err != nil {
		t.Fatalf("AddPrepayment #2: %v", err)
	}
	if _, err := svc.VerifyPrepayment(context.Background(), dispatcher.ID, "dispatcher", order.ID, VerifyPrepaymentRequest{}); err != nil {
		t.Fatalf("VerifyPrepayment #2: %v", err)
	}

	after, err := svc.ListPrepayments(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("ListPrepayments (after): %v", err)
	}
	if len(after) != 2 {
		t.Fatalf("expected 2 prepayment records, got %d", len(after))
	}
	for _, p := range after {
		if p.VerifiedAt == nil {
			t.Errorf("expected every record to be verified after the second VerifyPrepayment, got %+v", p)
		}
	}
	if !after[0].VerifiedAt.Equal(firstVerifiedAt) {
		t.Errorf("the first record's VerifiedAt should be unchanged by the second verification: was %v, now %v", firstVerifiedAt, after[0].VerifiedAt)
	}
}
