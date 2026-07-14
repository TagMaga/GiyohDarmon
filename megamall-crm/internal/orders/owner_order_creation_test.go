package orders

// owner_order_creation_test.go — DB-backed tests for owner-created orders
// (Task 7): the owner must always attribute an order to a real, active
// seller who belongs to the selected team — there is no owner-personal-order
// fallback.
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/orders/ -v -run TestOwnerOrder

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func buildOwnerOrderRequest(customerID, cityID, productID uuid.UUID, sellerID, teamID *uuid.UUID) CreateOrderRequest {
	req := buildOrderRequest(customerID, cityID, productID)
	req.SellerID = sellerID
	req.TeamID = teamID
	return req
}

// ─── Missing seller_id / team_id ──────────────────────────────────────────────

func TestOwnerOrder_MissingSellerID_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	sellerHier, err := hierRepo.GetByUserID(context.Background(), sellerID)
	if err != nil || sellerHier == nil {
		t.Fatalf("expected seller hierarchy to exist: %v", err)
	}

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	req := buildOwnerOrderRequest(customerID, cityID, product.ID, nil, sellerHier.TeamID)
	_, err = svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail without seller_id, got nil error")
	}
}

func TestOwnerOrder_MissingTeamID_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &sellerID, nil)
	_, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail without team_id, got nil error")
	}
}

// ─── Invalid seller_id ─────────────────────────────────────────────────────────

func TestOwnerOrder_NonexistentSeller_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	sellerHier, _ := hierRepo.GetByUserID(context.Background(), sellerID)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	bogusSellerID := uuid.New()
	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &bogusSellerID, sellerHier.TeamID)
	_, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail for a nonexistent seller_id, got nil error")
	}
}

func TestOwnerOrder_InactiveSeller_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	sellerHier, _ := hierRepo.GetByUserID(context.Background(), sellerID)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	deactivateUser(t, db, sellerID)

	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &sellerID, sellerHier.TeamID)
	_, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail for an inactive seller, got nil error")
	}
}

func TestOwnerOrder_WrongRole_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	managerID, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	sellerHier, _ := hierRepo.GetByUserID(context.Background(), sellerID)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	// managerID is a real, active user but not a seller — must be rejected
	// even though it shares the seller's team.
	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &managerID, sellerHier.TeamID)
	_, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail for a non-seller user, got nil error")
	}
}

func TestOwnerOrder_SellerNotInSelectedTeam_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	// A second, unrelated team — the seller above does not belong to it.
	_, _, otherSellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	otherSellerHier, err := hierRepo.GetByUserID(context.Background(), otherSellerID)
	if err != nil || otherSellerHier == nil {
		t.Fatalf("expected other seller hierarchy to exist: %v", err)
	}

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	// Real seller, but paired with the wrong team_id.
	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &sellerID, otherSellerHier.TeamID)
	_, err = svc.Create(context.Background(), owner.ID, "owner", req)
	if err == nil {
		t.Fatal("expected order creation to fail when seller does not belong to the selected team, got nil error")
	}
}

// ─── Valid happy path ──────────────────────────────────────────────────────────

func TestOwnerOrder_ValidSellerAndTeam_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	managerID, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	sellerHier, err := hierRepo.GetByUserID(context.Background(), sellerID)
	if err != nil || sellerHier == nil || sellerHier.TeamID == nil {
		t.Fatalf("expected seller hierarchy with team to exist: %v", err)
	}

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	req := buildOwnerOrderRequest(customerID, cityID, product.ID, &sellerID, sellerHier.TeamID)
	order, err := svc.Create(context.Background(), owner.ID, "owner", req)
	if err != nil {
		t.Fatalf("expected owner order creation to succeed, got error: %v", err)
	}

	if order.SellerID != sellerID {
		t.Errorf("expected order.SellerID = %s, got %s", sellerID, order.SellerID)
	}
	if order.ManagerID == nil || *order.ManagerID != managerID {
		t.Errorf("expected order.ManagerID = %s, got %v", managerID, order.ManagerID)
	}
	if order.TeamLeadID == nil || *order.TeamLeadID != teamLeadID {
		t.Errorf("expected order.TeamLeadID = %s, got %v", teamLeadID, order.TeamLeadID)
	}
	if order.OrderType != OrderTypeSeller {
		t.Errorf("expected order.OrderType = %s, got %s", OrderTypeSeller, order.OrderType)
	}
	if order.SnapshotID == nil {
		t.Error("expected a financial snapshot to be attached to the order")
	}
}
