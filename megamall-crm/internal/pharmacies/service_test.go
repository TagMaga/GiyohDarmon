package pharmacies

import "testing"

func TestCalculatePaymentCommissionsApprovedExample(t *testing.T) {
	got, err := calculatePaymentCommissions(3800, &FinancialSnapshot{
		SellerRate:       0.10,
		ManagerTeamRate:  0.03,
		TeamLeadPoolRate: 0.40,
		CompanyRate:      0.60,
	})
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}
	if got.Seller != 380 || got.Manager != 114 || got.TeamLead != 1026 || got.Company != 2280 {
		t.Fatalf("unexpected breakdown: %+v", got)
	}
	if got.Seller+got.Manager+got.TeamLead+got.Company != 3800 {
		t.Fatalf("breakdown must reconcile to base: %+v", got)
	}
}

func TestCalculatePaymentCommissionsRoundsMoney(t *testing.T) {
	got, err := calculatePaymentCommissions(10.01, &FinancialSnapshot{
		SellerRate:       0.10,
		ManagerTeamRate:  0.03,
		TeamLeadPoolRate: 0.40,
		CompanyRate:      0.60,
	})
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}
	if got.Seller != 1 || got.Manager != 0.30 || got.TeamLead != 2.70 || got.Company != 6.01 {
		t.Fatalf("unexpected rounded breakdown: %+v", got)
	}
}

func TestCalculatePaymentCommissionsRejectsInvalidPool(t *testing.T) {
	_, err := calculatePaymentCommissions(100, &FinancialSnapshot{
		SellerRate:       0.30,
		ManagerTeamRate:  0.20,
		TeamLeadPoolRate: 0.40,
	})
	if err == nil {
		t.Fatal("expected invalid rate combination to fail")
	}
}
