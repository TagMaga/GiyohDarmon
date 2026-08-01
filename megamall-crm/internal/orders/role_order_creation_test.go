package orders

// role_order_creation_test.go — DB-backed QA coverage for order creation by
// every role that is allowed to place an order: seller, manager,
// sales_team_lead, dispatcher (owner is already covered by
// owner_order_creation_test.go). Exercises both the happy path per role and
// the role↔order_type / role↔seller_id guard rails in
// validateOrderTypeForRole and Service.Create.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/orders/ -v -run TestRoleOrder

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

// setupTeamWithSellerAndTeamID is setupTeamWithSeller but also returns the
// created team's ID, needed to give the manager/team-lead themselves a
// hierarchy row (self→team) before they can place their own personal order.
func setupTeamWithSellerAndTeamID(t *testing.T, db *gorm.DB, teamRepo *teams.Repository, hierRepo *hierarchy.Repository) (managerID, teamLeadID, sellerID, teamID uuid.UUID) {
	t.Helper()
	manager := testutil.CreateUser(t, db, users.RoleManager)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	team := &teams.Team{
		ID:         uuid.New(),
		Name:       "Test Team " + uuid.New().String()[:8],
		ManagerID:  &manager.ID,
		TeamLeadID: &lead.ID,
		IsActive:   true,
	}
	if err := teamRepo.Create(context.Background(), team); err != nil {
		t.Fatalf("create test team: %v", err)
	}
	if err := hierRepo.Upsert(context.Background(), &hierarchy.UserHierarchy{
		ID: uuid.New(), UserID: seller.ID, ParentID: &manager.ID, TeamID: &team.ID,
	}); err != nil {
		t.Fatalf("assign seller hierarchy: %v", err)
	}
	return manager.ID, lead.ID, seller.ID, team.ID
}

// assignSelfToTeam gives actorID a hierarchy row pointing at teamID, which
// Service.Create requires (via resolveHierarchy's pre-flight team-membership
// check) before actorID may place a non-house order for themselves — this is
// what a manager/team-lead's own hierarchy row looks like in production.
func assignSelfToTeam(t *testing.T, hierRepo *hierarchy.Repository, actorID, teamID uuid.UUID) {
	t.Helper()
	if err := hierRepo.Upsert(context.Background(), &hierarchy.UserHierarchy{
		ID: uuid.New(), UserID: actorID, TeamID: &teamID,
	}); err != nil {
		t.Fatalf("assign %s to team: %v", actorID, err)
	}
}

// setupOrderFixtures creates a customer, active city, product with stock —
// the non-role-specific prerequisites every order needs.
func setupOrderFixtures(t *testing.T, db *gorm.DB, stockOwnerID uuid.UUID) (customerID, cityID, productID uuid.UUID) {
	t.Helper()
	customerID = createTestCustomer(t, db)
	cityID = createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, stockOwnerID, 100)
	return customerID, cityID, product.ID
}

// ─── Seller ─────────────────────────────────────────────────────────────────

func TestRoleOrder_Seller_HappyPath_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)

	req := buildOrderRequest(customerID, cityID, productID) // OrderType: seller_order
	order, err := svc.Create(context.Background(), sellerID, "seller", req)
	if err != nil {
		t.Fatalf("expected seller order creation to succeed, got error: %v", err)
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
		t.Fatal("expected a financial snapshot to be attached to the order")
	}
	if order.Status != StatusConfirmed {
		t.Errorf("expected a no-prepayment order to auto-confirm, got status %s", order.Status)
	}
}

func TestRoleOrder_Seller_NoTeam_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller) // no hierarchy/team assigned

	customerID, cityID, productID := setupOrderFixtures(t, db, seller.ID)

	req := buildOrderRequest(customerID, cityID, productID)
	_, err := svc.Create(context.Background(), seller.ID, "seller", req)
	if err == nil {
		t.Fatal("expected order creation to fail for a seller with no team, got nil error")
	}
}

func TestRoleOrder_Seller_WrongOrderType_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)

	req := buildOrderRequest(customerID, cityID, productID)
	req.OrderType = OrderTypeManagerPersonal
	_, err := svc.Create(context.Background(), sellerID, "seller", req)
	if err == nil {
		t.Fatal("expected seller creating a manager_personal_order to be rejected, got nil error")
	}
}

// ─── Manager ────────────────────────────────────────────────────────────────

func TestRoleOrder_Manager_HappyPath_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, _, _, teamID := setupTeamWithSellerAndTeamID(t, db, teamRepo, hierRepo)
	assignSelfToTeam(t, hierRepo, managerID, teamID)

	customerID, cityID, productID := setupOrderFixtures(t, db, managerID)

	req := buildOrderRequest(customerID, cityID, productID)
	req.OrderType = OrderTypeManagerPersonal
	order, err := svc.Create(context.Background(), managerID, "manager", req)
	if err != nil {
		t.Fatalf("expected manager order creation to succeed, got error: %v", err)
	}
	if order.SellerID != managerID {
		t.Errorf("expected order.SellerID = %s (the manager), got %s", managerID, order.SellerID)
	}
	if order.OrderType != OrderTypeManagerPersonal {
		t.Errorf("expected order.OrderType = %s, got %s", OrderTypeManagerPersonal, order.OrderType)
	}
	if order.SnapshotID == nil {
		t.Fatal("expected a financial snapshot to be attached to the order")
	}
}

func TestRoleOrder_Manager_WrongOrderType_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, _, _, teamID := setupTeamWithSellerAndTeamID(t, db, teamRepo, hierRepo)
	assignSelfToTeam(t, hierRepo, managerID, teamID)

	customerID, cityID, productID := setupOrderFixtures(t, db, managerID)

	req := buildOrderRequest(customerID, cityID, productID) // OrderType: seller_order
	_, err := svc.Create(context.Background(), managerID, "manager", req)
	if err == nil {
		t.Fatal("expected manager creating a seller_order to be rejected, got nil error")
	}
}

// ─── Sales team lead ────────────────────────────────────────────────────────

func TestRoleOrder_TeamLead_HappyPath_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, teamLeadID, _, teamID := setupTeamWithSellerAndTeamID(t, db, teamRepo, hierRepo)
	assignSelfToTeam(t, hierRepo, teamLeadID, teamID)

	customerID, cityID, productID := setupOrderFixtures(t, db, teamLeadID)

	req := buildOrderRequest(customerID, cityID, productID)
	req.OrderType = OrderTypeTeamLeadPersonal
	order, err := svc.Create(context.Background(), teamLeadID, "sales_team_lead", req)
	if err != nil {
		t.Fatalf("expected team-lead order creation to succeed, got error: %v", err)
	}
	if order.SellerID != teamLeadID {
		t.Errorf("expected order.SellerID = %s (the team lead), got %s", teamLeadID, order.SellerID)
	}
	if order.OrderType != OrderTypeTeamLeadPersonal {
		t.Errorf("expected order.OrderType = %s, got %s", OrderTypeTeamLeadPersonal, order.OrderType)
	}
	if order.SnapshotID == nil {
		t.Fatal("expected a financial snapshot to be attached to the order")
	}
}

func TestRoleOrder_TeamLead_WrongOrderType_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, teamLeadID, _, teamID := setupTeamWithSellerAndTeamID(t, db, teamRepo, hierRepo)
	assignSelfToTeam(t, hierRepo, teamLeadID, teamID)

	customerID, cityID, productID := setupOrderFixtures(t, db, teamLeadID)

	req := buildOrderRequest(customerID, cityID, productID) // OrderType: seller_order
	_, err := svc.Create(context.Background(), teamLeadID, "sales_team_lead", req)
	if err == nil {
		t.Fatal("expected sales_team_lead creating a seller_order to be rejected, got nil error")
	}
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

func TestRoleOrder_Dispatcher_HappyPath_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)

	req := buildOrderRequest(customerID, cityID, productID) // OrderType: seller_order
	req.SellerID = &sellerID
	order, err := svc.Create(context.Background(), dispatcher.ID, "dispatcher", req)
	if err != nil {
		t.Fatalf("expected dispatcher order creation to succeed, got error: %v", err)
	}
	if order.SellerID != sellerID {
		t.Errorf("expected order.SellerID = %s (the seller placed on behalf of), got %s", sellerID, order.SellerID)
	}
	if order.ManagerID == nil || *order.ManagerID != managerID {
		t.Errorf("expected order.ManagerID = %s, got %v", managerID, order.ManagerID)
	}
	if order.TeamLeadID == nil || *order.TeamLeadID != teamLeadID {
		t.Errorf("expected order.TeamLeadID = %s, got %v", teamLeadID, order.TeamLeadID)
	}
	if order.SnapshotID == nil {
		t.Fatal("expected a financial snapshot to be attached to the order")
	}
}

func TestRoleOrder_Dispatcher_ForceStatusNew_Honored(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)

	req := buildOrderRequest(customerID, cityID, productID)
	req.SellerID = &sellerID
	forced := string(StatusNew)
	req.ForceStatus = &forced
	order, err := svc.Create(context.Background(), dispatcher.ID, "dispatcher", req)
	if err != nil {
		t.Fatalf("expected dispatcher office order to succeed, got error: %v", err)
	}
	if order.Status != StatusNew {
		t.Errorf("expected dispatcher's force_status=new to be honored, got status %s", order.Status)
	}
}

func TestRoleOrder_Dispatcher_MissingSellerID_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	customerID, cityID, productID := setupOrderFixtures(t, db, dispatcher.ID)

	req := buildOrderRequest(customerID, cityID, productID) // no SellerID set
	_, err := svc.Create(context.Background(), dispatcher.ID, "dispatcher", req)
	if err == nil {
		t.Fatal("expected dispatcher order with no seller_id to be rejected, got nil error")
	}
}

func TestRoleOrder_Dispatcher_WrongOrderType_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)
	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)

	req := buildOrderRequest(customerID, cityID, productID)
	req.SellerID = &sellerID
	req.OrderType = OrderTypeHouse
	_, err := svc.Create(context.Background(), dispatcher.ID, "dispatcher", req)
	if err == nil {
		t.Fatal("expected dispatcher creating a house_order to be rejected, got nil error")
	}
}
