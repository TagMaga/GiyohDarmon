package compensation

// income_test.go — Pure unit tests for Phase 14 income reporting logic.
//
// No database, no network required.
// Run with: go test ./internal/compensation/ -v -run TestIncome

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

func near2i(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff < 0.005
}

func mustUUID() uuid.UUID { return uuid.New() }

// ─── CheckIncomeAccess RBAC tests ─────────────────────────────────────────────

// TestCheckIncomeAccess_OwnerCanReadAnyUser verifies that owner role bypasses
// all cross-user restrictions.
func TestCheckIncomeAccess_OwnerCanReadAnyUser(t *testing.T) {
	ownerID := mustUUID()
	anyUserID := mustUUID()

	err := CheckIncomeAccess(ownerID, anyUserID, "owner", false)
	if err != nil {
		t.Errorf("owner should be able to read any user, got error: %v", err)
	}
}

// TestCheckIncomeAccess_OwnerCanReadSelf verifies owner self-access.
func TestCheckIncomeAccess_OwnerCanReadSelf(t *testing.T) {
	id := mustUUID()
	if err := CheckIncomeAccess(id, id, "owner", false); err != nil {
		t.Errorf("owner self-access denied: %v", err)
	}
}

// TestCheckIncomeAccess_SellerCanReadOwnIncome verifies seller can read own income.
func TestCheckIncomeAccess_SellerCanReadOwnIncome(t *testing.T) {
	id := mustUUID()
	if err := CheckIncomeAccess(id, id, "seller", false); err != nil {
		t.Errorf("seller self-access denied: %v", err)
	}
}

// TestCheckIncomeAccess_SellerCannotReadOthers verifies seller cannot read another user.
func TestCheckIncomeAccess_SellerCannotReadOthers(t *testing.T) {
	sellerID := mustUUID()
	otherID := mustUUID()

	err := CheckIncomeAccess(sellerID, otherID, "seller", false)
	if err == nil {
		t.Error("seller should NOT be able to read another user's income")
	}
}

// TestCheckIncomeAccess_SellerCannotReadOthers_WithRelation verifies that even
// hasOrderRelation=true does not grant a seller cross-user access.
func TestCheckIncomeAccess_SellerCannotReadOthers_WithRelation(t *testing.T) {
	sellerID := mustUUID()
	otherID := mustUUID()

	err := CheckIncomeAccess(sellerID, otherID, "seller", true)
	if err == nil {
		t.Error("seller should NOT be able to read another user's income even with hasOrderRelation=true")
	}
}

// TestCheckIncomeAccess_ManagerCanReadOwnIncome verifies manager self-access.
func TestCheckIncomeAccess_ManagerCanReadOwnIncome(t *testing.T) {
	id := mustUUID()
	if err := CheckIncomeAccess(id, id, "manager", false); err != nil {
		t.Errorf("manager self-access denied: %v", err)
	}
}

// TestCheckIncomeAccess_ManagerCanReadSellerUnderThem verifies a manager can read
// income of a seller who has an order with manager_id = actorID.
func TestCheckIncomeAccess_ManagerCanReadSellerUnderThem(t *testing.T) {
	managerID := mustUUID()
	sellerID := mustUUID()

	// hasOrderRelation=true simulates DB confirmation that an order exists
	// with manager_id = managerID AND seller_id = sellerID.
	err := CheckIncomeAccess(managerID, sellerID, "manager", true)
	if err != nil {
		t.Errorf("manager should be able to read income of managed seller, got: %v", err)
	}
}

// TestCheckIncomeAccess_ManagerCannotReadUnrelatedSeller verifies that a manager
// without any shared order cannot read a seller's income.
func TestCheckIncomeAccess_ManagerCannotReadUnrelatedSeller(t *testing.T) {
	managerID := mustUUID()
	unrelatedSellerID := mustUUID()

	// hasOrderRelation=false: no shared orders exist.
	err := CheckIncomeAccess(managerID, unrelatedSellerID, "manager", false)
	if err == nil {
		t.Error("manager should NOT be able to read income of unrelated seller")
	}
}

// TestCheckIncomeAccess_TeamLeadCanReadTeamMember verifies a team lead can read
// income for a user whose orders have team_lead_id = actorID.
func TestCheckIncomeAccess_TeamLeadCanReadTeamMember(t *testing.T) {
	tlID := mustUUID()
	memberID := mustUUID()

	err := CheckIncomeAccess(tlID, memberID, "sales_team_lead", true)
	if err != nil {
		t.Errorf("team lead should be able to read team member income, got: %v", err)
	}
}

// TestCheckIncomeAccess_TeamLeadCannotReadNonMember verifies a team lead cannot
// read income for a user outside their team.
func TestCheckIncomeAccess_TeamLeadCannotReadNonMember(t *testing.T) {
	tlID := mustUUID()
	outsiderID := mustUUID()

	err := CheckIncomeAccess(tlID, outsiderID, "sales_team_lead", false)
	if err == nil {
		t.Error("team lead should NOT be able to read income of non-team-member")
	}
}

// TestCheckIncomeAccess_ForbiddenRoles verifies dispatcher, courier, and warehouse
// cannot access any income endpoint.
func TestCheckIncomeAccess_ForbiddenRoles(t *testing.T) {
	id := mustUUID()
	forbiddenRoles := []string{"dispatcher", "courier", "warehouse_manager"}

	for _, role := range forbiddenRoles {
		// Even self-access should be denied.
		err := CheckIncomeAccess(id, id, role, false)
		if err == nil {
			t.Errorf("role %q should be forbidden from income access", role)
		}
	}
}

// ─── Income report assembly tests ─────────────────────────────────────────────

// TestBuildIncomeReportFromRows_GroupsByEventType verifies that the report
// correctly maps each event type to its summed amount.
func TestBuildIncomeReportFromRows_GroupsByEventType(t *testing.T) {
	uid := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	agg := []incomeAggRow{
		{EventType: "seller_commission_earned", Total: 80.0, OrdersCount: 10},
		{EventType: "manager_team_commission_earned", Total: 24.0, OrdersCount: 10},
	}

	report := buildIncomeReportFromRows(uid, from, to, 104.0, 10, agg)

	if !near2i(report.TotalIncome, 104.0) {
		t.Errorf("TotalIncome: got %.2f, want 104.00", report.TotalIncome)
	}
	if !near2i(report.ByEventType["seller_commission_earned"], 80.0) {
		t.Errorf("seller: got %.2f, want 80.00", report.ByEventType["seller_commission_earned"])
	}
	if !near2i(report.ByEventType["manager_team_commission_earned"], 24.0) {
		t.Errorf("manager_team: got %.2f, want 24.00", report.ByEventType["manager_team_commission_earned"])
	}
	if report.OrdersCount != 10 {
		t.Errorf("OrdersCount: got %d, want 10", report.OrdersCount)
	}
	if !near2i(report.AveragePerOrder, 10.40) {
		t.Errorf("AveragePerOrder: got %.2f, want 10.40", report.AveragePerOrder)
	}
}

// TestBuildIncomeReportFromRows_ExcludesCompanyRevenue verifies that
// company_revenue_earned never appears in personal income.
//
// The DB query uses WHERE user_id = X, so company_revenue_earned rows
// (which have user_id NULL) are naturally excluded. This test confirms
// the assembly function handles that correctly: if the DB returns no
// company event rows, the report should not contain a company entry.
func TestBuildIncomeReportFromRows_ExcludesCompanyRevenue(t *testing.T) {
	uid := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	// The DB correctly excluded company_revenue_earned (user_id filter).
	agg := []incomeAggRow{
		{EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
		{EventType: "team_lead_pool_earned", Total: 21.6, OrdersCount: 1},
	}

	report := buildIncomeReportFromRows(uid, from, to, 29.6, 1, agg)

	if _, ok := report.ByEventType[string(EventCompanyRevenueEarned)]; ok {
		t.Error("company_revenue_earned must NOT appear in personal income report")
	}
	if !near2i(report.TotalIncome, 29.6) {
		t.Errorf("TotalIncome: got %.2f, want 29.60", report.TotalIncome)
	}
}

// TestBuildIncomeReportFromRows_VerifiedOrderAmounts validates the verified
// financial amounts for a seller_order with net_revenue=80.
func TestBuildIncomeReportFromRows_VerifiedOrderAmounts(t *testing.T) {
	// Verified result from E2E tests (seller_order, total=100, fee=20, net=80):
	//   company = 80 × 0.60 = 48         (user_id NULL — excluded from personal)
	//   seller  = 80 × 0.10 = 8          (user_id = sellerID)
	//   mgr_team= 80 × 0.03 = 2.4        (user_id = managerID)
	//   pool    = 80 - 48 - 8 - 2.4 = 21.6 (user_id = teamLeadID)
	uid := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	// Simulate what DB returns for the seller (user_id = sellerID):
	agg := []incomeAggRow{
		{EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
	}
	report := buildIncomeReportFromRows(uid, from, to, 8.0, 1, agg)

	if !near2i(report.TotalIncome, 8.0) {
		t.Errorf("seller income: got %.2f, want 8.00", report.TotalIncome)
	}
	if !near2i(report.AveragePerOrder, 8.0) {
		t.Errorf("average: got %.2f, want 8.00", report.AveragePerOrder)
	}
}

// TestBuildTeamReport_AggregatesMembers verifies the team report aggregation.
func TestBuildTeamReport_AggregatesMembers(t *testing.T) {
	tlID := mustUUID()
	seller1 := mustUUID()
	seller2 := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	rows := []teamMemberIncomeRow{
		{UserID: seller1, EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
		{UserID: seller1, EventType: "manager_team_commission_earned", Total: 2.4, OrdersCount: 1},
		{UserID: seller2, EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
		{UserID: tlID, EventType: "team_lead_pool_earned", Total: 21.6, OrdersCount: 1},
	}

	report := buildTeamReport(tlID, from, to, rows)

	if report.TeamLeadID != tlID {
		t.Errorf("TeamLeadID mismatch")
	}
	if len(report.Members) != 3 {
		t.Errorf("Members count: got %d, want 3", len(report.Members))
	}
	if !near2i(report.TotalIncome, 40.0) {
		t.Errorf("TotalIncome: got %.2f, want 40.00 (8+2.4+8+21.6)", report.TotalIncome)
	}
	if !near2i(report.ByEventType["seller_commission_earned"], 16.0) {
		t.Errorf("team seller total: got %.2f, want 16.00", report.ByEventType["seller_commission_earned"])
	}
	if !near2i(report.ByEventType["team_lead_pool_earned"], 21.6) {
		t.Errorf("team pool: got %.2f, want 21.60", report.ByEventType["team_lead_pool_earned"])
	}
}

// TestBuildIncomeReportFromRows_ZeroOrders verifies no panic and sensible values
// when there are no orders in the period.
func TestBuildIncomeReportFromRows_ZeroOrders(t *testing.T) {
	uid := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	report := buildIncomeReportFromRows(uid, from, to, 0, 0, nil)

	if report.TotalIncome != 0 {
		t.Errorf("TotalIncome should be 0 for empty period, got %.2f", report.TotalIncome)
	}
	if report.AveragePerOrder != 0 {
		t.Errorf("AveragePerOrder should be 0 (no divide by zero), got %.2f", report.AveragePerOrder)
	}
	if report.ByEventType == nil {
		t.Error("ByEventType must not be nil (should be empty map)")
	}
}

// TestParsePeriod_DefaultsToCurrentMonth verifies that empty strings yield the
// start of the current month as the from date.
func TestParsePeriod_DefaultsToCurrentMonth(t *testing.T) {
	from, _, err := parsePeriod("", "")
	if err != nil {
		t.Fatalf("parsePeriod with empty strings failed: %v", err)
	}
	now := time.Now().UTC()
	if from.Year() != now.Year() || from.Month() != now.Month() || from.Day() != 1 {
		t.Errorf("default from should be start of current month, got %v", from)
	}
}

// TestParsePeriod_ParsesCorrectly verifies date string parsing.
func TestParsePeriod_ParsesCorrectly(t *testing.T) {
	from, to, err := parsePeriod("2026-06-01", "2026-06-30")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if from.Year() != 2026 || from.Month() != 6 || from.Day() != 1 {
		t.Errorf("from: got %v", from)
	}
	if to.Year() != 2026 || to.Month() != 6 || to.Day() != 30 {
		t.Errorf("to: got %v", to)
	}
	// to should include the full end day.
	if to.Hour() != 23 || to.Minute() != 59 {
		t.Errorf("to should be end of day, got %v", to)
	}
}

// TestParsePeriod_InvalidDateReturnsError verifies bad date strings are rejected.
func TestParsePeriod_InvalidDateReturnsError(t *testing.T) {
	_, _, err := parsePeriod("not-a-date", "")
	if err == nil {
		t.Error("expected error for invalid from date")
	}
	_, _, err = parsePeriod("", "2026/06/30") // wrong separator
	if err == nil {
		t.Error("expected error for invalid to date")
	}
}

// TestManagerPersonalOrder_IncomeVerified validates the verified financial amounts
// for a manager_personal_order with net_revenue=80.
func TestManagerPersonalOrder_IncomeVerified(t *testing.T) {
	// Verified from E2E:
	//   manager_personal_order, net=80:
	//   company=48 (excluded — user_id NULL), manager_personal=16, team_lead_pool=16
	uid := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	// What DB returns for the manager (user_id = managerID):
	agg := []incomeAggRow{
		{EventType: "manager_personal_commission_earned", Total: 16.0, OrdersCount: 1},
	}
	report := buildIncomeReportFromRows(uid, from, to, 16.0, 1, agg)

	if !near2i(report.TotalIncome, 16.0) {
		t.Errorf("manager personal income: got %.2f, want 16.00", report.TotalIncome)
	}
	if !near2i(report.ByEventType["manager_personal_commission_earned"], 16.0) {
		t.Errorf("by_event_type: got %.2f", report.ByEventType["manager_personal_commission_earned"])
	}
	if _, ok := report.ByEventType[string(EventCompanyRevenueEarned)]; ok {
		t.Error("company_revenue_earned must not appear in manager personal income")
	}
}
