package logistics

// courier_debt_shortfall_test.go — owner-side courier debt must include the
// confirmed-handover shortfall, matching the courier app's cash summary
// (internal/courier GetCashSummary): a handover expected at 209 but
// confirmed at 200 leaves the courier owing 9 everywhere, not just in the
// mobile app.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

func insertConfirmedShortHandover(t *testing.T, db *gorm.DB, courierID uuid.UUID, toReturn, actual float64) {
	t.Helper()
	err := db.Exec(`
		INSERT INTO cash_handovers
			(id, courier_id, total_collected, total_delivery_fees, total_to_return, actual_returned, status, confirmed_at)
		VALUES (?, ?, ?, 0, ?, ?, 'confirmed', NOW())
	`, uuid.New(), courierID, toReturn, toReturn, actual).Error
	if err != nil {
		t.Fatalf("insert confirmed handover: %v", err)
	}
}

func TestOwnerSideDebt_IncludesConfirmedShortfall(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)

	insertConfirmedShortHandover(t, db, c.ID, 209, 200)

	// Couriers list
	list, err := repo.ListCouriers(ctx)
	if err != nil {
		t.Fatalf("list couriers: %v", err)
	}
	var found bool
	for _, row := range list {
		if row.CourierID == c.ID {
			found = true
			if row.CashDebt != 9 {
				t.Fatalf("ListCouriers cash_debt = %v, want 9", row.CashDebt)
			}
		}
	}
	if !found {
		t.Fatalf("courier %s missing from ListCouriers", c.ID)
	}

	// Courier detail
	detail, err := repo.GetCourier(ctx, c.ID)
	if err != nil {
		t.Fatalf("get courier: %v", err)
	}
	if detail.CashDebt != 9 {
		t.Fatalf("GetCourier cash_debt = %v, want 9", detail.CashDebt)
	}

	// Dashboard totals
	dash, err := repo.GetDashboard(ctx)
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if dash.CashExpected != 9 {
		t.Fatalf("dashboard cash_expected = %v, want 9", dash.CashExpected)
	}
	if dash.CashInCirculation != 9 {
		t.Fatalf("dashboard cash_in_circulation = %v, want 9", dash.CashInCirculation)
	}
	if dash.BiggestDebtCourier == nil || dash.BiggestDebtCourier.CashDebt != 9 {
		t.Fatalf("dashboard biggest debt courier = %+v, want cash_debt 9", dash.BiggestDebtCourier)
	}
}
