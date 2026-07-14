package orders

// owner_order_creation_test.go — DB-backed tests for owner-created orders:
// the owner creates a "house order" with no seller/team attribution and no
// commission paid to anyone — the full commission base goes to company
// revenue (see compensation.ApplyCommissionRules — OrderTypeHouseOrder).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/orders/ -v -run TestOwnerOrder

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func buildOwnerOrderRequest(customerID, cityID, productID uuid.UUID) CreateOrderRequest {
	req := buildOrderRequest(customerID, cityID, productID)
	req.OrderType = OrderTypeHouse
	return req
}

// ─── Owner cannot create a non-house order type ────────────────────────────────

func TestOwnerOrder_SellerOrderType_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)

	req := buildOrderRequest(customerID, cityID, product.ID) // OrderType: seller_order
	_, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected owner creating a seller_order to be rejected, got nil error")
	}
}

// ─── Happy path — house order, no attribution, no commission ──────────────────

func TestOwnerOrder_HouseOrder_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, owner.ID, 100)

	req := buildOwnerOrderRequest(customerID, cityID, product.ID)
	order, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err != nil {
		t.Fatalf("expected owner house-order creation to succeed, got error: %v", err)
	}

	if order.SellerID != owner.ID {
		t.Errorf("expected order.SellerID = %s (the owner), got %s", owner.ID, order.SellerID)
	}
	if order.ManagerID != nil {
		t.Errorf("expected order.ManagerID = nil for a house order, got %v", *order.ManagerID)
	}
	if order.TeamLeadID != nil {
		t.Errorf("expected order.TeamLeadID = nil for a house order, got %v", *order.TeamLeadID)
	}
	if order.OrderType != OrderTypeHouse {
		t.Errorf("expected order.OrderType = %s, got %s", OrderTypeHouse, order.OrderType)
	}
	if order.SnapshotID == nil {
		t.Fatal("expected a financial snapshot to be attached to the order")
	}
}

// ─── Commission rules: house order pays 100% to company, 0 to everyone else ───

func TestOwnerOrder_HouseOrder_CommissionRules_NoOneEarnsACut(t *testing.T) {
	snap := &compensation.OrderFinancialSnapshot{
		SellerRate:          0.10,
		ManagerTeamRate:      0.05,
		ManagerPersonalRate:  0.08,
		TeamLeadPoolRate:     0.20,
		CompanyRate:          0.75,
	}
	netRevenue := 1000.0

	breakdown, err := compensation.ApplyCommissionRules(compensation.OrderTypeHouseOrder, netRevenue, snap)
	if err != nil {
		t.Fatalf("expected house_order commission rules to succeed, got error: %v", err)
	}
	if breakdown.SellerCommission != 0 {
		t.Errorf("expected SellerCommission = 0, got %v", breakdown.SellerCommission)
	}
	if breakdown.ManagerTeamCommission != 0 {
		t.Errorf("expected ManagerTeamCommission = 0, got %v", breakdown.ManagerTeamCommission)
	}
	if breakdown.ManagerPersonalCommission != 0 {
		t.Errorf("expected ManagerPersonalCommission = 0, got %v", breakdown.ManagerPersonalCommission)
	}
	if breakdown.TeamLeadPool != 0 {
		t.Errorf("expected TeamLeadPool = 0, got %v", breakdown.TeamLeadPool)
	}
	if breakdown.CompanyRevenue != netRevenue {
		t.Errorf("expected CompanyRevenue = %v (100%% of net revenue), got %v", netRevenue, breakdown.CompanyRevenue)
	}
}
