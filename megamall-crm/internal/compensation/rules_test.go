package compensation

// rules_test.go — pure unit tests for ApplyCommissionRules.
//
// No database, no network, no fixtures required.
// Run with: go test ./internal/compensation/ -v -run TestApply

import (
	"math"
	"testing"
)

// snap builds a minimal OrderFinancialSnapshot with the given rates.
func snap(sellerRate, mgrTeam, mgrPersonal, tlPool, company float64) *OrderFinancialSnapshot {
	return &OrderFinancialSnapshot{
		SellerRate:          sellerRate,
		ManagerTeamRate:     mgrTeam,
		ManagerPersonalRate: mgrPersonal,
		TeamLeadPoolRate:    tlPool,   // stored but not used in calculation
		CompanyRate:         company,
	}
}

// near2 returns true if a and b are within 1 cent of each other.
func near2(a, b float64) bool { return math.Abs(a-b) < 0.005 }

// sumBreakdown returns the sum of all breakdown amounts.
func sumBreakdown(b CommissionBreakdown) float64 {
	return b.CompanyRevenue + b.SellerCommission +
		b.ManagerTeamCommission + b.ManagerPersonalCommission +
		b.TeamLeadPool
}

// ─── seller_order ──────────────────────────────────────────────────────────────

func TestApply_SellerOrder_BasicMath(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	b, err := ApplyCommissionRules(OrderTypeSellerOrder, 80.0, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !near2(b.CompanyRevenue, 48.0) {
		t.Errorf("CompanyRevenue: got %.2f, want 48.00", b.CompanyRevenue)
	}
	if !near2(b.SellerCommission, 8.0) {
		t.Errorf("SellerCommission: got %.2f, want 8.00", b.SellerCommission)
	}
	if !near2(b.ManagerTeamCommission, 2.40) {
		t.Errorf("ManagerTeamCommission: got %.2f, want 2.40", b.ManagerTeamCommission)
	}
	if b.ManagerPersonalCommission != 0 {
		t.Errorf("ManagerPersonalCommission: got %.2f, want 0", b.ManagerPersonalCommission)
	}
	// pool = 80 - 48 - 8 - 2.40 = 21.60
	if !near2(b.TeamLeadPool, 21.60) {
		t.Errorf("TeamLeadPool: got %.2f, want 21.60 (residual)", b.TeamLeadPool)
	}
}

func TestApply_SellerOrder_SumEqualsNetRevenue(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	nr := 123.45
	b, err := ApplyCommissionRules(OrderTypeSellerOrder, nr, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := sumBreakdown(b)
	if !near2(got, nr) {
		t.Errorf("sum of breakdown (%.4f) != net_revenue (%.4f)", got, nr)
	}
}

func TestApply_SellerOrder_TeamLeadPoolRateIgnored(t *testing.T) {
	// team_lead_pool_rate is in the snapshot but must NOT affect the pool amount.
	// Two snapshots with different tlPool rates → same breakdown if other rates equal.
	s1 := snap(0.10, 0.03, 0.20, 0.05, 0.60) // tlPool=0.05
	s2 := snap(0.10, 0.03, 0.20, 0.90, 0.60) // tlPool=0.90 (different)
	b1, _ := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s1)
	b2, _ := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s2)
	if b1.TeamLeadPool != b2.TeamLeadPool {
		t.Errorf("TeamLeadPool should be identical regardless of team_lead_pool_rate: %.2f vs %.2f",
			b1.TeamLeadPool, b2.TeamLeadPool)
	}
}

func TestApply_SellerOrder_ValidationError(t *testing.T) {
	// company(0.60) + seller(0.30) + mgr_team(0.20) = 1.10 → must fail
	s := snap(0.30, 0.20, 0.20, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for rate sum > 1.0, got nil")
	}
}

func TestApply_SellerOrder_ExactlyOne_AllowedNotFailed(t *testing.T) {
	// company(0.60) + seller(0.20) + mgr_team(0.20) = 1.00 → pool = 0 → allowed
	s := snap(0.20, 0.20, 0.20, 0.40, 0.60)
	b, err := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s)
	if err != nil {
		t.Fatalf("unexpected error at sum=1.0: %v", err)
	}
	if !near2(b.TeamLeadPool, 0.0) {
		t.Errorf("pool should be 0 when rates sum to 1.0, got %.4f", b.TeamLeadPool)
	}
}

// ─── manager_personal_order ────────────────────────────────────────────────────

func TestApply_ManagerPersonalOrder_BasicMath(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	b, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 80.0, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !near2(b.CompanyRevenue, 48.0) {
		t.Errorf("CompanyRevenue: got %.2f, want 48.00", b.CompanyRevenue)
	}
	if b.SellerCommission != 0 {
		t.Errorf("SellerCommission: got %.2f, want 0", b.SellerCommission)
	}
	if b.ManagerTeamCommission != 0 {
		t.Errorf("ManagerTeamCommission: got %.2f, want 0 (cannot double-pay)", b.ManagerTeamCommission)
	}
	if !near2(b.ManagerPersonalCommission, 16.0) {
		t.Errorf("ManagerPersonalCommission: got %.2f, want 16.00", b.ManagerPersonalCommission)
	}
	// pool = 80 - 48 - 16 = 16
	if !near2(b.TeamLeadPool, 16.0) {
		t.Errorf("TeamLeadPool: got %.2f, want 16.00 (residual)", b.TeamLeadPool)
	}
}

func TestApply_ManagerPersonalOrder_SumEqualsNetRevenue(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	nr := 99.99
	b, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, nr, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !near2(sumBreakdown(b), nr) {
		t.Errorf("sum (%.4f) != net_revenue (%.4f)", sumBreakdown(b), nr)
	}
}

func TestApply_ManagerPersonalOrder_ValidationError(t *testing.T) {
	// company(0.60) + personal(0.50) = 1.10 → fail
	s := snap(0.10, 0.03, 0.50, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for rate sum > 1.0, got nil")
	}
}

// ─── team_lead_personal_order ──────────────────────────────────────────────────

func TestApply_TeamLeadPersonalOrder_BasicMath(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	b, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, 80.0, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !near2(b.CompanyRevenue, 48.0) {
		t.Errorf("CompanyRevenue: got %.2f, want 48.00", b.CompanyRevenue)
	}
	if b.SellerCommission != 0 {
		t.Errorf("SellerCommission: got %.2f, want 0", b.SellerCommission)
	}
	if !near2(b.ManagerTeamCommission, 2.40) {
		t.Errorf("ManagerTeamCommission: got %.2f, want 2.40", b.ManagerTeamCommission)
	}
	if b.ManagerPersonalCommission != 0 {
		t.Errorf("ManagerPersonalCommission: got %.2f, want 0", b.ManagerPersonalCommission)
	}
	// pool = 80 - 48 - 2.40 = 29.60
	if !near2(b.TeamLeadPool, 29.60) {
		t.Errorf("TeamLeadPool: got %.2f, want 29.60 (residual)", b.TeamLeadPool)
	}
}

func TestApply_TeamLeadPersonalOrder_SumEqualsNetRevenue(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	nr := 47.13
	b, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, nr, s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !near2(sumBreakdown(b), nr) {
		t.Errorf("sum (%.4f) != net_revenue (%.4f)", sumBreakdown(b), nr)
	}
}

func TestApply_TeamLeadPersonalOrder_ValidationError(t *testing.T) {
	// company(0.60) + mgr_team(0.50) = 1.10 → fail
	s := snap(0.10, 0.50, 0.20, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for rate sum > 1.0, got nil")
	}
}

// ─── aggregate example from spec ──────────────────────────────────────────────

// TestApply_SpecExample validates the 10-order aggregate example from the spec:
//
//	8 seller orders @ net=80  → combined net = 640
//	1 manager personal order  → net = 80
//	1 team_lead personal order → net = 80
//	total net_revenue = 800
//
//	Rates: company=0.60, seller=0.10, manager_team=0.03, manager_personal=0.20
//
//	Expected aggregates:
//	  company            = 800 × 0.60 = 480
//	  seller             = 640 × 0.10 =  64
//	  manager_team       = 720 × 0.03 =  21.6   (seller+tl_personal nets)
//	  manager_personal   =  80 × 0.20 =  16
//	  pool               = 800 - 480 - 64 - 21.6 - 16 = 218.4
func TestApply_SpecExample_AggregateConsistency(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60) // tlPool kept but ignored

	var totals CommissionBreakdown

	// 8 seller orders, each net=80
	for i := 0; i < 8; i++ {
		b, err := ApplyCommissionRules(OrderTypeSellerOrder, 80.0, s)
		if err != nil {
			t.Fatalf("seller order %d: %v", i, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.SellerCommission += b.SellerCommission
		totals.ManagerTeamCommission += b.ManagerTeamCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}

	// 1 manager_personal order, net=80
	{
		b, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 80.0, s)
		if err != nil {
			t.Fatalf("manager_personal order: %v", err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.ManagerPersonalCommission += b.ManagerPersonalCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}

	// 1 team_lead_personal order, net=80
	{
		b, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, 80.0, s)
		if err != nil {
			t.Fatalf("team_lead_personal order: %v", err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.ManagerTeamCommission += b.ManagerTeamCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}

	totalNR := 800.0

	if !near2(totals.CompanyRevenue, 480.0) {
		t.Errorf("company_revenue: got %.2f, want 480.00", totals.CompanyRevenue)
	}
	if !near2(totals.SellerCommission, 64.0) {
		t.Errorf("seller_commission: got %.2f, want 64.00", totals.SellerCommission)
	}
	if !near2(totals.ManagerTeamCommission, 21.6) {
		t.Errorf("manager_team_commission: got %.2f, want 21.60", totals.ManagerTeamCommission)
	}
	if !near2(totals.ManagerPersonalCommission, 16.0) {
		t.Errorf("manager_personal_commission: got %.2f, want 16.00", totals.ManagerPersonalCommission)
	}
	if !near2(totals.TeamLeadPool, 218.4) {
		t.Errorf("team_lead_pool: got %.2f, want 218.40", totals.TeamLeadPool)
	}
	if !near2(sumBreakdown(totals), totalNR) {
		t.Errorf("total sum: got %.2f, want %.2f", sumBreakdown(totals), totalNR)
	}
}

// ─── unknown order type ────────────────────────────────────────────────────────

func TestApply_UnknownOrderType_ReturnsError(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	_, err := ApplyCommissionRules("invalid_type", 100.0, s)
	if err == nil {
		t.Fatal("expected error for unknown order type, got nil")
	}
}

// ─── rounding ─────────────────────────────────────────────────────────────────

func TestApply_Round2_HalfUp(t *testing.T) {
	// 1/3 of 100 → 33.333... rounds to 33.33
	if v := round2(100.0 / 3.0); v != 33.33 {
		t.Errorf("round2(33.333...): got %.4f, want 33.33", v)
	}
	// 2/3 of 100 → 66.666... rounds to 66.67
	if v := round2(200.0 / 3.0); v != 66.67 {
		t.Errorf("round2(66.666...): got %.4f, want 66.67", v)
	}
}

func TestApply_SellerOrder_SumPreservesRounding(t *testing.T) {
	// Use amounts that generate awkward fractions.
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	for _, nr := range []float64{1.00, 7.77, 33.33, 100.01, 999.99} {
		b, err := ApplyCommissionRules(OrderTypeSellerOrder, nr, s)
		if err != nil {
			t.Fatalf("nr=%.2f: %v", nr, err)
		}
		got := sumBreakdown(b)
		if !near2(got, nr) {
			t.Errorf("nr=%.2f: sum=%.4f (diff=%.4f exceeds 0.005)",
				nr, got, math.Abs(got-nr))
		}
	}
}
