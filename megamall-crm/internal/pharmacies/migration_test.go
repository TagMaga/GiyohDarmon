package pharmacies

import (
	"os"
	"testing"

	"github.com/megamall/crm/internal/testutil"
)

func TestPharmacyMigrationCreatesLedgersAndUnifiedIncomeView(t *testing.T) {
	if os.Getenv("TEST_ADMIN_DSN") == "" {
		t.Skip("TEST_ADMIN_DSN is required for migration integration test")
	}
	db := testutil.NewTestDB(t)
	for _, name := range []string{
		"pharmacies",
		"pharmacy_invoices",
		"pharmacy_payments",
		"pharmacy_returns",
		"pharmacy_financial_events",
		"pharmacy_events",
	} {
		if !db.Migrator().HasTable(name) {
			t.Fatalf("migration did not create %s", name)
		}
	}
	var viewName string
	if err := db.Raw(`
		SELECT table_name FROM information_schema.views
		WHERE table_schema='public' AND table_name='unified_income_events'
	`).Scan(&viewName).Error; err != nil {
		t.Fatalf("query unified income view: %v", err)
	}
	if viewName != "unified_income_events" {
		t.Fatal("migration did not create unified_income_events view")
	}
}
