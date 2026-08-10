package dispatch

import "testing"

func TestCashSettlementSuccessRate_IgnoresIssueOrders(t *testing.T) {
	delivered := 10
	failed := 2
	issue := 5

	got := cashSettlementSuccessRate(delivered, failed)
	if got == nil {
		t.Fatal("expected success rate, got nil")
	}
	want := float64(delivered) * 100 / float64(delivered+failed)
	if *got != want {
		t.Fatalf("success rate with %d issue orders ignored: got %.4f, want %.4f", issue, *got, want)
	}
}

// CashDebt used to be computed by a pure period-bounded function
// (cashSettlementDebt: collected − earnings − handed_over, all scoped to
// the filter's date range). That formula was removed in favor of a
// debt_cte in GetCashSettlement's SQL using the same current,
// not-period-scoped, order-exclusion formula every other panel uses (see
// the debt_cte comment in repository.go) — the period-bounded version
// could disagree with the rest of the app whenever a delivery and its
// handover's confirmation fell in different filter windows. DB-backed
// coverage for the new formula lives alongside the other GetCashSettlement
// tests exercising the repository directly.
