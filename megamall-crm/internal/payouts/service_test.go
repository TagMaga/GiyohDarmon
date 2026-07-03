package payouts

// service_test.go — pure unit tests for the payouts aggregation/validation
// logic (buildPayablesResponse, computeRemaining, validatePayoutItems).
//
// No database, no network, no fixtures required — mirrors the pattern in
// internal/compensation/rules_test.go and internal/finance/finance_test.go.
//
// Run with: go test ./internal/payouts/ -v

import (
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	apperrors "github.com/megamall/crm/pkg/errors"
)

func near2(a, b float64) bool { return math.Abs(a-b) < 0.005 }

// ─── computeRemaining ──────────────────────────────────────────────────────────

func TestComputeRemaining_Basic(t *testing.T) {
	if got := computeRemaining(100, 40); !near2(got, 60) {
		t.Errorf("got %.2f, want 60.00", got)
	}
}

func TestComputeRemaining_FloorsAtZero(t *testing.T) {
	// Overpaid (shouldn't happen once the amount ceiling is enforced, but the
	// display math must never go negative regardless).
	if got := computeRemaining(50, 80); got != 0 {
		t.Errorf("got %.2f, want 0 (floored)", got)
	}
}

func TestComputeRemaining_ExactMatch(t *testing.T) {
	if got := computeRemaining(75.3, 75.3); got != 0 {
		t.Errorf("got %.2f, want 0", got)
	}
}

// ─── buildPayablesResponse ─────────────────────────────────────────────────────

func TestBuildPayablesResponse_FiltersToManagerAndSellerOnly(t *testing.T) {
	teamLeadID := uuid.New()
	courierID := uuid.New()
	managerID := uuid.New()
	sellerID := uuid.New()

	members := []compensation.TeamMemberIncome{
		{UserID: teamLeadID, TotalIncome: 677.7}, // the team lead's own pool row
		{UserID: courierID, TotalIncome: 20},     // courier_fee_earned, must be excluded
		{UserID: managerID, TotalIncome: 75.3},
		{UserID: sellerID, TotalIncome: 251},
	}
	users := map[uuid.UUID]userInfo{
		teamLeadID: {ID: teamLeadID, FullName: "Team Lead Demo", Role: "sales_team_lead"},
		courierID:  {ID: courierID, FullName: "Courier Demo", Role: "courier"},
		managerID:  {ID: managerID, FullName: "Manager Demo", Role: "manager"},
		sellerID:   {ID: sellerID, FullName: "Seller Demo", Role: "seller"},
	}
	gross := map[uuid.UUID]orderTotalsRow{
		managerID: {UserID: managerID, GrossAmount: 2990, OrdersCount: 3},
		sellerID:  {UserID: sellerID, GrossAmount: 2990, OrdersCount: 3},
	}
	alreadyPaid := map[uuid.UUID]float64{managerID: 75.3}

	from := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 7, 3, 0, 0, 0, 0, time.UTC)

	resp := buildPayablesResponse(teamLeadID, from, to, members, users, gross, alreadyPaid, 677.7)

	if len(resp.Members) != 2 {
		t.Fatalf("len(Members) = %d, want 2 (courier and team lead excluded)", len(resp.Members))
	}
	for _, m := range resp.Members {
		if m.Role != "manager" && m.Role != "seller" {
			t.Errorf("unexpected role in payables list: %s", m.Role)
		}
	}
}

func TestBuildPayablesResponse_TeamTotals(t *testing.T) {
	teamLeadID := uuid.New()
	managerID := uuid.New()
	sellerID := uuid.New()

	members := []compensation.TeamMemberIncome{
		{UserID: managerID, TotalIncome: 75.3},
		{UserID: sellerID, TotalIncome: 251},
	}
	users := map[uuid.UUID]userInfo{
		managerID: {ID: managerID, FullName: "Manager Demo", Role: "manager"},
		sellerID:  {ID: sellerID, FullName: "Seller Demo", Role: "seller"},
	}
	alreadyPaid := map[uuid.UUID]float64{managerID: 75.3} // fully paid, seller untouched

	resp := buildPayablesResponse(teamLeadID, time.Now(), time.Now(), members, users, nil, alreadyPaid, 677.7)

	if !near2(resp.TeamEarned, 326.3) {
		t.Errorf("TeamEarned = %.2f, want 326.30", resp.TeamEarned)
	}
	if !near2(resp.TeamPaid, 75.3) {
		t.Errorf("TeamPaid = %.2f, want 75.30", resp.TeamPaid)
	}
	if !near2(resp.TeamRemaining, 251) {
		t.Errorf("TeamRemaining = %.2f, want 251.00", resp.TeamRemaining)
	}
}

// TestBuildPayablesResponse_PersonalNetIsNotDoubleSubtracted is a regression
// test for the bug fixed in this session: PersonalNet used to be
// personalPool - sum(payouts already made), which double-subtracted staff
// commissions that ApplyCommissionRules already nets out of
// team_lead_pool_earned before it's ever recorded.
func TestBuildPayablesResponse_PersonalNetIsNotDoubleSubtracted(t *testing.T) {
	teamLeadID := uuid.New()
	managerID := uuid.New()

	members := []compensation.TeamMemberIncome{{UserID: managerID, TotalIncome: 75.3}}
	users := map[uuid.UUID]userInfo{managerID: {ID: managerID, Role: "manager"}}
	alreadyPaid := map[uuid.UUID]float64{managerID: 75.3} // team lead already paid the manager in full

	const personalPool = 677.7
	resp := buildPayablesResponse(teamLeadID, time.Now(), time.Now(), members, users, nil, alreadyPaid, personalPool)

	if !near2(resp.PersonalNet, personalPool) {
		t.Errorf("PersonalNet = %.2f, want %.2f (== PersonalPool, unaffected by staff payouts)", resp.PersonalNet, personalPool)
	}
	if !near2(resp.PersonalPool, personalPool) {
		t.Errorf("PersonalPool = %.2f, want %.2f", resp.PersonalPool, personalPool)
	}
}

// ─── validatePayoutItems ────────────────────────────────────────────────────────

func appErrCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := apperrors.AsAppError(err)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestValidatePayoutItems_OwnerUnrestricted(t *testing.T) {
	items := []CreatePayoutItem{{PayeeID: uuid.New(), Amount: 999999}}
	if err := validatePayoutItems(items, nil, false); err != nil {
		t.Errorf("owner (unrestricted) should never be rejected here, got: %v", err)
	}
}

func TestValidatePayoutItems_RejectsPayeeNotInTeam(t *testing.T) {
	payeeID := uuid.New()
	items := []CreatePayoutItem{{PayeeID: payeeID, Amount: 10}}
	err := validatePayoutItems(items, map[uuid.UUID]PayableMember{}, true)
	if err == nil {
		t.Fatal("expected an error for a payee outside the team's payables list")
	}
	if code := appErrCode(t, err); code != apperrors.CodeForbidden {
		t.Errorf("code = %s, want FORBIDDEN", code)
	}
}

func TestValidatePayoutItems_RejectsAmountAboveRemaining(t *testing.T) {
	payeeID := uuid.New()
	allowed := map[uuid.UUID]PayableMember{
		payeeID: {PayeeID: payeeID, FullName: "Manager Demo", Remaining: 75.3},
	}
	items := []CreatePayoutItem{{PayeeID: payeeID, Amount: 500}}
	err := validatePayoutItems(items, allowed, true)
	if err == nil {
		t.Fatal("expected an error — amount exceeds what's actually owed")
	}
	if code := appErrCode(t, err); code != apperrors.CodeBadRequest {
		t.Errorf("code = %s, want BAD_REQUEST", code)
	}
}

func TestValidatePayoutItems_AllowsExactRemaining(t *testing.T) {
	payeeID := uuid.New()
	allowed := map[uuid.UUID]PayableMember{
		payeeID: {PayeeID: payeeID, Remaining: 75.3},
	}
	items := []CreatePayoutItem{{PayeeID: payeeID, Amount: 75.3}}
	if err := validatePayoutItems(items, allowed, true); err != nil {
		t.Errorf("paying exactly the remaining amount should be allowed, got: %v", err)
	}
}

func TestValidatePayoutItems_AllowsPartialAmount(t *testing.T) {
	payeeID := uuid.New()
	allowed := map[uuid.UUID]PayableMember{
		payeeID: {PayeeID: payeeID, Remaining: 251},
	}
	items := []CreatePayoutItem{{PayeeID: payeeID, Amount: 100}}
	if err := validatePayoutItems(items, allowed, true); err != nil {
		t.Errorf("a partial payment within remaining should be allowed, got: %v", err)
	}
}
