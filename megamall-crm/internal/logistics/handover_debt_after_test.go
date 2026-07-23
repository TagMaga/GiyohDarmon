package logistics

// handover_debt_after_test.go — ListHandovers' per-row "courier_debt_after"
// running balance (owner Логистика → Передачи кассы table).
//
// A confirmed handover under-paid on 22.07 (expected 200.03, actual 111)
// leaves the courier owing 89.03 — same shortfall math as
// courier_debt_shortfall_test.go. A later zero-order "settlement" handover
// (total_to_return = 0, actual_returned = 89, matching internal/courier
// Service.SubmitHandover's zero-line-settlement path) pays that down.
// courier_debt_after must show the running balance after each row: 89.03
// after the first, ~0.03 after the second — never resetting to a bare "0"
// just because the settlement itself expected nothing new. It must also be
// computed over the courier's whole history, not just what's visible under
// the list's own from/to/courier filters.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

func approxEqual(a, b float64) bool { return math.Abs(a-b) < 0.005 }

// insertConfirmedShortHandoverAt is insertConfirmedShortHandover with an
// explicit created_at, so ordering between rows inserted in the same test
// doesn't depend on the wall-clock gap between two INSERT statements (which
// could tie at typical timestamp precision and make the window function's
// ORDER BY created_at, id tiebreak on a random UUID instead).
func insertConfirmedShortHandoverAt(t *testing.T, db *gorm.DB, courierID uuid.UUID, toReturn, actual float64, at time.Time) {
	t.Helper()
	err := db.Exec(`
		INSERT INTO cash_handovers
			(id, courier_id, total_collected, total_delivery_fees, total_to_return, actual_returned, status, confirmed_at, created_at)
		VALUES (?, ?, ?, 0, ?, ?, 'confirmed', ?, ?)
	`, uuid.New(), courierID, toReturn, toReturn, actual, at, at).Error
	if err != nil {
		t.Fatalf("insert confirmed handover: %v", err)
	}
}

func TestListHandovers_CourierDebtAfter_RunningBalance(t *testing.T) {
	db := testutil.NewTestDB(t)
	ctx := context.Background()
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)

	day1 := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)

	// 22.07 — under-paid: expected 200.03, actual 111 → +89.03 debt.
	insertConfirmedShortHandoverAt(t, db, courier.ID, 200.03, 111, day1)
	// 23.07 — zero-order settlement: nothing new expected, courier pays 89
	// toward the existing debt.
	insertConfirmedShortHandoverAt(t, db, courier.ID, 0, 89, day2)

	rows, total, err := repo.ListHandovers(ctx, pagination.Params{Page: 1, Limit: 50}, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("list handovers: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}

	// ListHandovers orders created_at DESC, so rows[0] is the 23.07
	// settlement and rows[1] is the 22.07 shortfall.
	settlement, shortfall := rows[0], rows[1]

	if shortfall.TotalToReturn != 200.03 || shortfall.ActualReturned == nil || *shortfall.ActualReturned != 111 {
		t.Fatalf("unexpected shortfall row: %+v", shortfall)
	}
	if !approxEqual(shortfall.CourierDebtAfter, 89.03) {
		t.Fatalf("shortfall row courier_debt_after = %v, want ~89.03", shortfall.CourierDebtAfter)
	}

	if settlement.TotalToReturn != 0 || settlement.ActualReturned == nil || *settlement.ActualReturned != 89 {
		t.Fatalf("unexpected settlement row: %+v", settlement)
	}
	if !approxEqual(settlement.CourierDebtAfter, 0.03) {
		t.Fatalf("settlement row courier_debt_after = %v, want ~0.03 (89.03 debt − 89 paid)", settlement.CourierDebtAfter)
	}

	// Filtering to only the settlement row (e.g. a narrow date range on the
	// owner's page) must not lose the debt that was created outside the
	// filter — courier_debt_after is computed over the courier's whole
	// history, independent of this query's own from/to window.
	from := settlement.CreatedAt.Add(-time.Minute)
	filtered, filteredTotal, err := repo.ListHandovers(ctx, pagination.Params{Page: 1, Limit: 50}, nil, "", &from, nil)
	if err != nil {
		t.Fatalf("list handovers (filtered): %v", err)
	}
	if filteredTotal != 1 {
		t.Fatalf("filtered total = %d, want 1 (only the settlement row)", filteredTotal)
	}
	if !approxEqual(filtered[0].CourierDebtAfter, 0.03) {
		t.Fatalf("filtered settlement row courier_debt_after = %v, want ~0.03 even though the 22.07 shortfall row is filtered out", filtered[0].CourierDebtAfter)
	}
}
