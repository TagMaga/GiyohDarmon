package logistics

// manual_handover_credit_test.go — the owner's manual cash-handover entry
// point (CreateHandover: courier + amount only, never linked to specific
// orders) must actually reduce the courier's debt once confirmed.
//
// Before this fix, a confirmed handover's amount only ever reduced debt via
// two mechanisms: (1) excluding its linked orders from the per-order SUM —
// impossible here, since this entry point never creates cash_handover_orders
// rows, or (2) its own shortfall term (total_to_return − actual_returned),
// which is zero whenever the owner enters matching totals (the normal case)
// — so the recorded cash silently vanished from every debt figure.
//
// The fix distinguishes "no order links because this is a manual entry"
// (cash_handovers.source = 'manual', credit the full amount) from "no order
// links because the courier app's own SubmitHandover legitimately created a
// zero-eligible-orders debt-paydown handover" (source = 'courier_app',
// default — must NOT get this extra credit, since insertConfirmedShortHandover
// / createConfirmedHandover-style fixtures across the test suite already
// represent that shape without ever creating order links either). Comparing
// the same numbers under both sources is exactly what proves the two are
// now handled differently, on purpose.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).

import (
	"context"
	"testing"
	"time"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func TestOwnerSideDebt_ManualHandoverCreditsFullAmount(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	repo := NewRepository(db, time.UTC)

	courierApp := testutil.CreateUser(t, db, users.RoleCourier)
	manual := testutil.CreateUser(t, db, users.RoleCourier)

	// Identical numbers, different source: total_to_return=209, actual=200.
	insertConfirmedShortHandover(t, db, courierApp.ID, 209, 200)
	if err := db.Exec(`
		INSERT INTO cash_handovers
			(id, courier_id, total_collected, total_delivery_fees, total_to_return, actual_returned, status, confirmed_at, source)
		VALUES (gen_random_uuid(), ?, 209, 0, 209, 200, 'confirmed', NOW(), 'manual')
	`, manual.ID).Error; err != nil {
		t.Fatalf("insert manual confirmed handover: %v", err)
	}

	list, err := repo.ListCouriers(ctx)
	if err != nil {
		t.Fatalf("list couriers: %v", err)
	}

	var gotCourierApp, gotManual float64
	var foundCourierApp, foundManual bool
	for _, row := range list {
		switch row.CourierID {
		case courierApp.ID:
			gotCourierApp, foundCourierApp = row.CashDebt, true
		case manual.ID:
			gotManual, foundManual = row.CashDebt, true
		}
	}
	if !foundCourierApp || !foundManual {
		t.Fatalf("missing courier(s) from ListCouriers: courierApp found=%v manual found=%v", foundCourierApp, foundManual)
	}

	// courier_app source: only the 9-shortfall counts (unchanged, existing behavior).
	if gotCourierApp != 9 {
		t.Fatalf("courier_app-sourced handover debt = %v, want 9 (shortfall only)", gotCourierApp)
	}
	// manual source: the full actual amount (200) is credited on top of the
	// shortfall (9), driving debt to GREATEST(0, 9 - 200) = 0 — proving the
	// manual entry's cash was actually counted, not silently dropped.
	if gotManual != 0 {
		t.Fatalf("manual-sourced handover debt = %v, want 0 (full amount credited, floored at 0)", gotManual)
	}
}
