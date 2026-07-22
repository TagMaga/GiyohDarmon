package courier

// cash_summary_test.go — "Нужно вернуть сегодня" must keep counting money a
// confirmed handover fell short on.
//
// The bug: a handover expected at 209 was confirmed with actual_returned =
// 200; its orders then dropped out of the debt query entirely, so the
// courier app showed 0 while the owner's logistics table showed −9. The 9
// the courier still physically holds must stay in cash_to_handover until
// the owner edits the handover's actual amount up or nets it against an
// overpayment on a later confirmed handover.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

func f64(v float64) *float64 { return &v }

func createConfirmedHandover(t *testing.T, db *gorm.DB, courierID uuid.UUID, toReturn float64, actual *float64) {
	t.Helper()
	h := &CashHandover{
		ID:                uuid.New(),
		CourierID:         courierID,
		TotalCollected:    toReturn,
		TotalDeliveryFees: 0,
		TotalToReturn:     toReturn,
		ActualReturned:    actual,
		Status:            HandoverStatusConfirmed,
	}
	if err := db.Create(h).Error; err != nil {
		t.Fatalf("create confirmed handover: %v", err)
	}
}

func TestGetCashSummary_ConfirmedShortfallStaysInDebt(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db)

	// Expected 209, owner confirmed only 200 → courier still owes 9.
	createConfirmedHandover(t, db, c.ID, 209, f64(200))

	s, err := repo.GetCashSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("cash summary: %v", err)
	}
	if s.CashToHandover != 9 {
		t.Fatalf("cash_to_handover = %v, want 9 (the confirmed-handover shortfall)", s.CashToHandover)
	}
}

func TestGetCashSummary_OverpaymentNetsShortfallOut(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db)

	// Short 9 on the first handover, 9 extra on the second → settled.
	createConfirmedHandover(t, db, c.ID, 209, f64(200))
	createConfirmedHandover(t, db, c.ID, 100, f64(109))

	s, err := repo.GetCashSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("cash summary: %v", err)
	}
	if s.CashToHandover != 0 {
		t.Fatalf("cash_to_handover = %v, want 0 after the overpayment nets the shortfall", s.CashToHandover)
	}
}

func TestGetCashSummary_PureOverpaymentNeverGoesNegative(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db)

	createConfirmedHandover(t, db, c.ID, 100, f64(150))

	s, err := repo.GetCashSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("cash summary: %v", err)
	}
	if s.CashToHandover != 0 {
		t.Fatalf("cash_to_handover = %v, want 0 (floored, never negative)", s.CashToHandover)
	}
}

func TestGetCashSummary_NullActualMeansAcceptedAsDeclared(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db)

	// Legacy rows confirmed without an explicit actual amount count as paid
	// in full — no phantom debt.
	createConfirmedHandover(t, db, c.ID, 300, nil)

	s, err := repo.GetCashSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("cash summary: %v", err)
	}
	if s.CashToHandover != 0 {
		t.Fatalf("cash_to_handover = %v, want 0 for NULL actual_returned", s.CashToHandover)
	}
}
