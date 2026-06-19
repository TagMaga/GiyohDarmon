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

// Courier owes the FULL cash collected from clients; courier payout is a separate
// company expense and is NOT deducted from the cash debt.
func TestCashSettlementDebt_RemainingCashHeld(t *testing.T) {
	got := cashSettlementDebt(1000, 700)
	if got != 300 {
		t.Fatalf("debt: got %.2f, want 300.00", got)
	}
}

func TestCashSettlementDebt_ZeroWhenFullySettled(t *testing.T) {
	got := cashSettlementDebt(1000, 1000)
	if got != 0 {
		t.Fatalf("debt: got %.2f, want 0.00", got)
	}
}
