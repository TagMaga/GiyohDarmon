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

// Cash debt = collected − courier_earnings − already_handed_over.
// Courier owes the net amount after subtracting their payout and prior handovers.
func TestCashSettlementDebt_RemainingCashHeld(t *testing.T) {
	// collected=1000, earnings=200, handed=500 → debt=300
	got := cashSettlementDebt(1000, 200, 500)
	if got != 300 {
		t.Fatalf("debt: got %.2f, want 300.00", got)
	}
}

func TestCashSettlementDebt_ZeroWhenFullySettled(t *testing.T) {
	// collected=1000, earnings=200, handed=800 → debt=0
	got := cashSettlementDebt(1000, 200, 800)
	if got != 0 {
		t.Fatalf("debt: got %.2f, want 0.00", got)
	}
}

func TestCashSettlementDebt_EarningsReduceDebt(t *testing.T) {
	// Higher earnings → lower debt: collected=500, earnings=150, handed=200 → debt=150
	got := cashSettlementDebt(500, 150, 200)
	if got != 150 {
		t.Fatalf("debt: got %.2f, want 150.00", got)
	}
}
