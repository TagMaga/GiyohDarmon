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
		TeamLeadPoolRate:    tlPool,
		CompanyRate:         company, // stored but not used in calculation (company is residual)
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
	// pool_gross = 80*0.40 = 32; pool = 32 - 8 - 2.40 = 21.60
	if !near2(b.TeamLeadPool, 21.60) {
		t.Errorf("TeamLeadPool: got %.2f, want 21.60 (pool_gross minus seller/manager)", b.TeamLeadPool)
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

func TestApply_SellerOrder_CompanyRateIgnored(t *testing.T) {
	// company_rate is in the snapshot but must NOT affect seller/manager/pool amounts —
	// company is the residual (net_revenue - pool_gross), computed after the fact.
	s1 := snap(0.10, 0.03, 0.20, 0.40, 0.10) // company=0.10
	s2 := snap(0.10, 0.03, 0.20, 0.40, 0.90) // company=0.90 (different)
	b1, _ := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s1)
	b2, _ := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s2)
	if b1.SellerCommission != b2.SellerCommission || b1.ManagerTeamCommission != b2.ManagerTeamCommission || b1.TeamLeadPool != b2.TeamLeadPool {
		t.Errorf("seller/manager/pool should be identical regardless of company_rate")
	}
	if b1.CompanyRevenue != b2.CompanyRevenue {
		// expected: both = net_revenue - pool_gross = 100 - 40 = 60, regardless of company_rate input
		if !near2(b1.CompanyRevenue, 60.0) || !near2(b2.CompanyRevenue, 60.0) {
			t.Errorf("CompanyRevenue should be net_revenue-pool_gross=60 regardless of company_rate: got %.2f, %.2f", b1.CompanyRevenue, b2.CompanyRevenue)
		}
	}
}

func TestApply_SellerOrder_ValidationError(t *testing.T) {
	// seller(0.30) + mgr_team(0.20) = 0.50 exceeds team_lead_pool_rate(0.40) → must fail
	s := snap(0.30, 0.20, 0.20, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for seller+manager > team_lead_pool_rate, got nil")
	}
}

func TestApply_SellerOrder_ExactlyOne_AllowedNotFailed(t *testing.T) {
	// seller(0.20) + mgr_team(0.20) = 0.40 == team_lead_pool_rate(0.40) → pool = 0 → allowed
	s := snap(0.20, 0.20, 0.20, 0.40, 0.60)
	b, err := ApplyCommissionRules(OrderTypeSellerOrder, 100.0, s)
	if err != nil {
		t.Fatalf("unexpected error at sum=team_lead_pool_rate: %v", err)
	}
	if !near2(b.TeamLeadPool, 0.0) {
		t.Errorf("pool should be 0 when seller+manager equals team_lead_pool_rate, got %.4f", b.TeamLeadPool)
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
	// pool_gross = 80*0.40 = 32; pool = 32 - 16 = 16
	if !near2(b.TeamLeadPool, 16.0) {
		t.Errorf("TeamLeadPool: got %.2f, want 16.00 (pool_gross minus manager)", b.TeamLeadPool)
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
	// personal(0.50) exceeds team_lead_pool_rate(0.40) → fail
	s := snap(0.10, 0.03, 0.50, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for manager_personal_rate > team_lead_pool_rate, got nil")
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
	// pool_gross = 80*0.40 = 32; pool = 32 - 2.40 = 29.60
	if !near2(b.TeamLeadPool, 29.60) {
		t.Errorf("TeamLeadPool: got %.2f, want 29.60 (pool_gross minus manager)", b.TeamLeadPool)
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
	// mgr_team(0.50) exceeds team_lead_pool_rate(0.40) → fail
	s := snap(0.10, 0.50, 0.20, 0.40, 0.60)
	_, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, 100.0, s)
	if err == nil {
		t.Fatal("expected validation error for manager_team_rate > team_lead_pool_rate, got nil")
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

func TestApply_MegaMall23OrderScenario(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)

	var totals CommissionBreakdown
	totalSales := 23.0 * 100.0
	courierPayout := 23.0 * 20.0
	commissionBasePerOrder := 100.0 - 20.0

	add := func(orderType OrderType, count int) {
		t.Helper()
		for i := 0; i < count; i++ {
			b, err := ApplyCommissionRules(orderType, commissionBasePerOrder, s)
			if err != nil {
				t.Fatalf("%s order %d: %v", orderType, i+1, err)
			}
			totals.CompanyRevenue += b.CompanyRevenue
			totals.SellerCommission += b.SellerCommission
			totals.ManagerTeamCommission += b.ManagerTeamCommission
			totals.ManagerPersonalCommission += b.ManagerPersonalCommission
			totals.TeamLeadPool += b.TeamLeadPool
		}
	}

	add(OrderTypeManagerPersonalOrder, 3)
	add(OrderTypeTeamLeadPersonalOrder, 2)
	add(OrderTypeSellerOrder, 18)

	managerTotal := totals.ManagerPersonalCommission + totals.ManagerTeamCommission
	finalTotal := courierPayout + totals.CompanyRevenue + totals.SellerCommission + managerTotal + totals.TeamLeadPool
	teamLeadGrossPool := totalSales - courierPayout - totals.CompanyRevenue

	if !near2(totalSales, 2300) {
		t.Fatalf("test setup total_sales: got %.2f, want 2300.00", totalSales)
	}
	if !near2(courierPayout, 460) {
		t.Errorf("courier: got %.2f, want 460.00", courierPayout)
	}
	if !near2(totalSales-courierPayout, 1840) {
		t.Errorf("commission_base: got %.2f, want 1840.00", totalSales-courierPayout)
	}
	if !near2(totals.CompanyRevenue, 1104) {
		t.Errorf("company: got %.2f, want 1104.00", totals.CompanyRevenue)
	}
	if !near2(teamLeadGrossPool, 736) {
		t.Errorf("team_lead_gross_pool: got %.2f, want 736.00", teamLeadGrossPool)
	}
	if !near2(totals.SellerCommission, 144) {
		t.Errorf("seller_income: got %.2f, want 144.00", totals.SellerCommission)
	}
	if !near2(totals.ManagerPersonalCommission, 48) {
		t.Errorf("manager own orders: got %.2f, want 48.00", totals.ManagerPersonalCommission)
	}
	if !near2(totals.ManagerTeamCommission, 48) {
		t.Errorf("manager override orders: got %.2f, want 48.00", totals.ManagerTeamCommission)
	}
	if !near2(managerTotal, 96) {
		t.Errorf("manager total: got %.2f, want 96.00", managerTotal)
	}
	if !near2(totals.TeamLeadPool, 496) {
		t.Errorf("team_lead_net: got %.2f, want 496.00", totals.TeamLeadPool)
	}
	if !near2(finalTotal, 2300) {
		t.Errorf("final total: got %.2f, want 2300.00", finalTotal)
	}
	if !near2(totals.TeamLeadPool, teamLeadGrossPool-totals.SellerCommission-managerTotal) {
		t.Errorf("team lead must be residual: net %.2f != gross %.2f - sellers %.2f - managers %.2f",
			totals.TeamLeadPool, teamLeadGrossPool, totals.SellerCommission, managerTotal)
	}
}

func TestApply_EdgeCaseZeroSellerOrders(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	var totals CommissionBreakdown
	for i := 0; i < 3; i++ {
		b, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 80, s)
		if err != nil {
			t.Fatalf("manager order %d: %v", i+1, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.ManagerPersonalCommission += b.ManagerPersonalCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}
	for i := 0; i < 2; i++ {
		b, err := ApplyCommissionRules(OrderTypeTeamLeadPersonalOrder, 80, s)
		if err != nil {
			t.Fatalf("team lead order %d: %v", i+1, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.ManagerTeamCommission += b.ManagerTeamCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}
	if totals.SellerCommission != 0 {
		t.Errorf("seller commission with 0 seller orders: got %.2f, want 0", totals.SellerCommission)
	}
	if !near2(sumBreakdown(totals), 400) {
		t.Errorf("total split: got %.2f, want 400.00", sumBreakdown(totals))
	}
}

func TestApply_EdgeCaseZeroManagerOwnOrders(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	var totals CommissionBreakdown
	for i := 0; i < 18; i++ {
		b, err := ApplyCommissionRules(OrderTypeSellerOrder, 80, s)
		if err != nil {
			t.Fatalf("seller order %d: %v", i+1, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.SellerCommission += b.SellerCommission
		totals.ManagerTeamCommission += b.ManagerTeamCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}
	if totals.ManagerPersonalCommission != 0 {
		t.Errorf("manager personal with 0 manager own orders: got %.2f, want 0", totals.ManagerPersonalCommission)
	}
	if !near2(totals.ManagerTeamCommission, 43.20) {
		t.Errorf("manager override from seller orders: got %.2f, want 43.20", totals.ManagerTeamCommission)
	}
}

func TestApply_EdgeCaseOnlySellers(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	var totals CommissionBreakdown
	for i := 0; i < 5; i++ {
		b, err := ApplyCommissionRules(OrderTypeSellerOrder, 80, s)
		if err != nil {
			t.Fatalf("seller order %d: %v", i+1, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.SellerCommission += b.SellerCommission
		totals.ManagerTeamCommission += b.ManagerTeamCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}
	if !near2(totals.SellerCommission, 40) {
		t.Errorf("seller total: got %.2f, want 40.00", totals.SellerCommission)
	}
	if !near2(totals.ManagerTeamCommission, 12) {
		t.Errorf("manager override total: got %.2f, want 12.00", totals.ManagerTeamCommission)
	}
	if !near2(totals.TeamLeadPool, 108) {
		t.Errorf("team lead residual: got %.2f, want 108.00", totals.TeamLeadPool)
	}
	if !near2(sumBreakdown(totals), 400) {
		t.Errorf("total split: got %.2f, want 400.00", sumBreakdown(totals))
	}
}

func TestApply_EdgeCaseOnlyManagerOwnOrders(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	var totals CommissionBreakdown
	for i := 0; i < 5; i++ {
		b, err := ApplyCommissionRules(OrderTypeManagerPersonalOrder, 80, s)
		if err != nil {
			t.Fatalf("manager order %d: %v", i+1, err)
		}
		totals.CompanyRevenue += b.CompanyRevenue
		totals.ManagerPersonalCommission += b.ManagerPersonalCommission
		totals.TeamLeadPool += b.TeamLeadPool
	}
	if totals.SellerCommission != 0 || totals.ManagerTeamCommission != 0 {
		t.Errorf("only manager own orders should not pay sellers or manager override: seller %.2f manager_team %.2f",
			totals.SellerCommission, totals.ManagerTeamCommission)
	}
	if !near2(totals.ManagerPersonalCommission, 80) {
		t.Errorf("manager personal total: got %.2f, want 80.00", totals.ManagerPersonalCommission)
	}
	if !near2(totals.TeamLeadPool, 80) {
		t.Errorf("team lead residual: got %.2f, want 80.00", totals.TeamLeadPool)
	}
	if !near2(sumBreakdown(totals), 400) {
		t.Errorf("total split: got %.2f, want 400.00", sumBreakdown(totals))
	}
}

func TestApply_EdgeCaseCourierPayoutDeductedBeforeCommission(t *testing.T) {
	s := snap(0.10, 0.03, 0.20, 0.40, 0.60)
	orderTotal := 100.0
	courierPayout := 20.0
	commissionBase := orderTotal - courierPayout

	b, err := ApplyCommissionRules(OrderTypeSellerOrder, commissionBase, s)
	if err != nil {
		t.Fatalf("seller order: %v", err)
	}

	if !near2(b.CompanyRevenue, 48) || !near2(b.SellerCommission, 8) ||
		!near2(b.ManagerTeamCommission, 2.40) || !near2(b.TeamLeadPool, 21.60) {
		t.Fatalf("commissions must be calculated from 80.00 base, got company %.2f seller %.2f manager %.2f tl %.2f",
			b.CompanyRevenue, b.SellerCommission, b.ManagerTeamCommission, b.TeamLeadPool)
	}
	if !near2(courierPayout+sumBreakdown(b), orderTotal) {
		t.Errorf("courier + commission split: got %.2f, want %.2f", courierPayout+sumBreakdown(b), orderTotal)
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
