package finance

// finance_test.go — Pure unit tests for Phase 15 finance logic.
//
// No database, no network required.
// Run with: go test ./internal/finance/ -v

import (
	"testing"
	"time"
)

// ─── buildRevenueSummary ──────────────────────────────────────────────────────

func TestBuildRevenueSummary_AllEventTypes(t *testing.T) {
	rows := []eventAggRow{
		{EventType: "company_revenue_earned", Total: 336},
		{EventType: "seller_commission_earned", Total: 48},
		{EventType: "manager_personal_commission_earned", Total: 16},
		{EventType: "manager_team_commission_earned", Total: 4.8},
		{EventType: "team_lead_pool_earned", Total: 145.6},
		{EventType: "courier_fee_earned", Total: 200},
	}

	rev := buildRevenueSummary(rows)

	if rev.CompanyRevenueEarned != 336 {
		t.Errorf("company: got %.2f, want 336", rev.CompanyRevenueEarned)
	}
	if rev.SellerCommissionEarned != 48 {
		t.Errorf("seller: got %.2f, want 48", rev.SellerCommissionEarned)
	}
	if rev.ManagerPersonalCommissionEarned != 16 {
		t.Errorf("mgr_personal: got %.2f, want 16", rev.ManagerPersonalCommissionEarned)
	}
	if !near2(rev.ManagerTeamCommissionEarned, 4.8) {
		t.Errorf("mgr_team: got %.2f, want 4.8", rev.ManagerTeamCommissionEarned)
	}
	if !near2(rev.TeamLeadPoolEarned, 145.6) {
		t.Errorf("team_lead_pool: got %.2f, want 145.6", rev.TeamLeadPoolEarned)
	}
	if !near2(rev.CourierPayouts, 200) {
		t.Errorf("courier_payouts: got %.2f, want 200", rev.CourierPayouts)
	}
}

// TestBuildRevenueSummary_TotalEmployeePayouts verifies the sum excludes company revenue.
// Expected: seller(48) + mgr_personal(16) + mgr_team(4.8) + pool(145.6) = 214.4
func TestBuildRevenueSummary_TotalEmployeePayouts(t *testing.T) {
	rows := []eventAggRow{
		{EventType: "company_revenue_earned", Total: 336},
		{EventType: "seller_commission_earned", Total: 48},
		{EventType: "manager_personal_commission_earned", Total: 16},
		{EventType: "manager_team_commission_earned", Total: 4.8},
		{EventType: "team_lead_pool_earned", Total: 145.6},
	}

	rev := buildRevenueSummary(rows)

	if !near2(rev.TotalEmployeePayouts, 214.4) {
		t.Errorf("total_employee_payouts: got %.4f, want 214.4", rev.TotalEmployeePayouts)
	}
}

func TestBuildRevenueSummary_MegaMall23OrderScenarioTotalsClose(t *testing.T) {
	rows := []eventAggRow{
		{EventType: "company_revenue_earned", Total: 1104},
		{EventType: "seller_commission_earned", Total: 144},
		{EventType: "manager_personal_commission_earned", Total: 48},
		{EventType: "manager_team_commission_earned", Total: 48},
		{EventType: "team_lead_pool_earned", Total: 496},
		{EventType: "courier_fee_earned", Total: 460},
	}

	rev := buildRevenueSummary(rows)
	employeeTotal := rev.SellerCommissionEarned +
		rev.ManagerPersonalCommissionEarned +
		rev.ManagerTeamCommissionEarned +
		rev.TeamLeadPoolEarned
	finalTotal := rev.CourierPayouts + rev.CompanyRevenueEarned + employeeTotal

	if !near2(rev.TotalEmployeePayouts, 736) {
		t.Errorf("team gross pool via employee payouts: got %.2f, want 736.00", rev.TotalEmployeePayouts)
	}
	if !near2(employeeTotal, 736) {
		t.Errorf("employee total: got %.2f, want 736.00", employeeTotal)
	}
	if !near2(finalTotal, 2300) {
		t.Errorf("courier + company + employees: got %.2f, want 2300.00", finalTotal)
	}
}

// TestBuildRevenueSummary_CompanyExcludedFromEmployeePayouts confirms company revenue
// is NOT included in total_employee_payouts even if present in rows.
func TestBuildRevenueSummary_CompanyExcludedFromEmployeePayouts(t *testing.T) {
	rows := []eventAggRow{
		{EventType: "company_revenue_earned", Total: 9999},
		{EventType: "seller_commission_earned", Total: 10},
	}

	rev := buildRevenueSummary(rows)

	if !near2(rev.TotalEmployeePayouts, 10) {
		t.Errorf("company should not count in employee payouts: got %.2f, want 10", rev.TotalEmployeePayouts)
	}
}

// TestBuildRevenueSummary_UnknownEventTypeIgnored verifies forward-compatibility:
// if a new event_type appears it should not crash or affect known totals.
func TestBuildRevenueSummary_UnknownEventTypeIgnored(t *testing.T) {
	rows := []eventAggRow{
		{EventType: "seller_commission_earned", Total: 50},
		{EventType: "future_bonus_type", Total: 999}, // unknown — should be ignored
	}

	rev := buildRevenueSummary(rows)

	if !near2(rev.TotalEmployeePayouts, 50) {
		t.Errorf("unknown event type inflated payouts: got %.2f, want 50", rev.TotalEmployeePayouts)
	}
}

// TestBuildRevenueSummary_EmptyRows returns zero-value struct without panicking.
func TestBuildRevenueSummary_EmptyRows(t *testing.T) {
	rev := buildRevenueSummary(nil)

	if rev.TotalEmployeePayouts != 0 {
		t.Errorf("empty rows: total_employee_payouts should be 0, got %.2f", rev.TotalEmployeePayouts)
	}
	if rev.CompanyRevenueEarned != 0 {
		t.Errorf("empty rows: company should be 0, got %.2f", rev.CompanyRevenueEarned)
	}
}

// ─── Cash outstanding calculation ─────────────────────────────────────────────

// TestCashOutstanding_Standard verifies cash_outstanding = collected - returned - courier salary kept.
func TestCashOutstanding_Standard(t *testing.T) {
	collected := 1000.0
	returned := 800.0
	courierSalary := 200.0
	want := 0.0

	got := roundFloat(collected - returned - courierSalary)

	if !near2(got, want) {
		t.Errorf("cash_outstanding: got %.2f, want %.2f", got, want)
	}
}

// TestCashOutstanding_ZeroWhenAllReturned handles case where courier returned everything.
func TestCashOutstanding_ZeroWhenAllReturned(t *testing.T) {
	got := roundFloat(500.0 - 500.0)
	if got != 0 {
		t.Errorf("expected 0 outstanding, got %.2f", got)
	}
}

// TestCashOutstanding_NegativeNotPossibleInPractice — outstanding can be negative
// only if actual_returned > total_collected (data anomaly). The calculation still
// produces a correct arithmetic result; the business layer should never reach this.
func TestCashOutstanding_FloatPrecision(t *testing.T) {
	// 4.8 is a recurring binary fraction; make sure roundFloat handles it.
	got := roundFloat(4.80)
	if !near2(got, 4.8) {
		t.Errorf("roundFloat(4.8): got %.10f", got)
	}
}

// ─── Net profit calculation ──────────────────────────────────────────────────
//
// Team payouts and company gross are no longer re-derived as a hardcoded
// percentage of orders.total_sales - orders.delivery_fees (that duplicated,
// and could drift from, the real per-order commission engine in
// internal/compensation). They now come straight from summed financial_events
// (rev.TotalEmployeePayouts / rev.CompanyRevenueEarned) — see buildRevenueSummary
// tests above for that arithmetic. computeNetProfit is the one remaining pure
// formula: company_gross - product_cost - business_expenses.

func TestComputeNetProfit_SubtractsProductCostAndExpenses(t *testing.T) {
	got := computeNetProfit(720, 90, 150)
	want := 480.0
	if !near2(got, want) {
		t.Errorf("net_profit: got %.2f, want %.2f", got, want)
	}
}

func TestComputeNetProfit_CanGoNegative(t *testing.T) {
	got := computeNetProfit(100, 90, 150)
	want := -140.0
	if !near2(got, want) {
		t.Errorf("net_profit: got %.2f, want %.2f", got, want)
	}
}

func TestComputeNetProfit_ZeroExpenses(t *testing.T) {
	got := computeNetProfit(600, 0, 0)
	if !near2(got, 600) {
		t.Errorf("net_profit: got %.2f, want 600", got)
	}
}

// ─── parsePeriod ──────────────────────────────────────────────────────────────

// TestParsePeriod_YYYYMMDDFormat verifies basic date parsing.
func TestParsePeriod_YYYYMMDDFormat(t *testing.T) {
	from, to, err := parsePeriod("2026-06-01", "2026-06-10", time.UTC)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if from.Year() != 2026 || from.Month() != 6 || from.Day() != 1 {
		t.Errorf("from: got %v", from)
	}
	// to is end-of-day on 2026-06-10: 2026-06-10T23:59:59.999999999Z
	if to.Year() != 2026 || to.Month() != 6 || to.Day() != 10 {
		t.Errorf("to: expected 2026-06-10, got %v", to)
	}
}

// TestParsePeriod_EmptyUsesCurrentMonth checks default behaviour.
func TestParsePeriod_EmptyUsesCurrentMonth(t *testing.T) {
	from, to, err := parsePeriod("", "", time.UTC)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if from.Day() != 1 {
		t.Errorf("default from: expected 1st of month, got day %d", from.Day())
	}
	if to.Before(from) {
		t.Errorf("default to must be after from: from=%v to=%v", from, to)
	}
}

// TestParsePeriod_RFC3339Format verifies RFC3339 is also accepted.
func TestParsePeriod_RFC3339Format(t *testing.T) {
	_, _, err := parsePeriod("2026-06-01T00:00:00Z", "2026-06-10T23:59:59Z", time.UTC)
	if err != nil {
		t.Fatalf("RFC3339 format rejected: %v", err)
	}
}

// TestParsePeriod_InvalidReturnsError confirms bad input is rejected.
func TestParsePeriod_InvalidReturnsError(t *testing.T) {
	_, _, err := parsePeriod("not-a-date", "", time.UTC)
	if err == nil {
		t.Error("expected error for invalid date string, got nil")
	}
}

// ─── roundFloat ───────────────────────────────────────────────────────────────

func TestRoundFloat_TwoDecimals(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{214.40, 214.40},
		{4.80, 4.80},
		{0.005, 0.01}, // rounds up
		{0.004, 0.00}, // rounds down
		{-0.005, -0.01},
	}
	for _, tc := range cases {
		got := roundFloat(tc.in)
		if !near2(got, tc.want) {
			t.Errorf("roundFloat(%.4f): got %.4f, want %.4f", tc.in, got, tc.want)
		}
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// near2 returns true when |a-b| < 0.005 (two-decimal precision tolerance).
func near2(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 0.005
}
