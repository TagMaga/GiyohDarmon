package orders

// hierarchy_resolution_test.go — DB-backed tests for the High-severity fix:
// resolveHierarchy must reject a team whose manager/team-lead has been
// deleted or deactivated, instead of silently freezing their user_id into
// new orders' financial snapshots and financial_events.
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/orders/ -v -run TestResolveHierarchy

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

// buildTestOrderService wires a real orders.Service against the given
// (transaction-scoped) DB, mirroring cmd/server/main.go's construction.
func buildTestOrderService(t *testing.T, db *gorm.DB) (*Service, *hierarchy.Repository, *teams.Repository) {
	t.Helper()
	hierRepo := hierarchy.NewRepository(db)
	teamRepo := teams.NewRepository(db)
	invRepo := inventory.NewRepository(db)
	activityLogger := activity.NewLogger(activity.NewRepository(db))
	compSvc := compensation.NewService(compensation.NewRepository(db), activityLogger, db)
	orderRepo := NewRepository(db, time.UTC)
	userRepo := users.NewRepository(db)
	sellerLookup := func(ctx context.Context, id uuid.UUID) (*SellerLookupResult, error) {
		u, err := userRepo.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if u == nil {
			return nil, nil
		}
		return &SellerLookupResult{IsActive: u.IsActive, Role: string(u.Role)}, nil
	}
	svc := NewService(orderRepo, invRepo, hierRepo, teamRepo, compSvc, activityLogger, db, sellerLookup)
	return svc, hierRepo, teamRepo
}

func createTestCity(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec(
		`INSERT INTO cities (id, name, is_active) VALUES (?, ?, true)`,
		id, "Test City "+id.String()[:8],
	).Error; err != nil {
		t.Fatalf("create test city: %v", err)
	}
	return id
}

func createTestCustomer(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	repo := customers.NewRepository(db)
	c := &customers.Customer{
		ID:       uuid.New(),
		FullName: "Test Customer",
		Phone:    "+1" + uuid.New().String()[:9],
	}
	if err := repo.Create(context.Background(), c); err != nil {
		t.Fatalf("create test customer: %v", err)
	}
	return c.ID
}

// setupTeamWithSeller creates a manager, team lead, team, and a seller
// belonging to that team, returning their IDs.
func setupTeamWithSeller(t *testing.T, db *gorm.DB, teamRepo *teams.Repository, hierRepo *hierarchy.Repository) (managerID, teamLeadID, sellerID uuid.UUID) {
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
	return manager.ID, lead.ID, seller.ID
}

func deactivateUser(t *testing.T, db *gorm.DB, userID uuid.UUID) {
	t.Helper()
	if err := db.Table("users").Where("id = ?", userID).Update("is_active", false).Error; err != nil {
		t.Fatalf("deactivate user: %v", err)
	}
}

func softDeleteUser(t *testing.T, db *gorm.DB, userID uuid.UUID) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Table("users").Where("id = ?", userID).Update("deleted_at", now).Error; err != nil {
		t.Fatalf("soft-delete user: %v", err)
	}
}

func buildOrderRequest(customerID, cityID, productID uuid.UUID) CreateOrderRequest {
	return CreateOrderRequest{
		CustomerID: customerID,
		OrderType:  OrderTypeSeller,
		CityID:     cityID,
		Items: []OrderItemRequest{
			{ProductID: productID, Quantity: 1, UnitPrice: 100},
		},
		DeliveryMethod: "normal",
	}
}

// ─── Deleted manager / team lead must block new orders ───────────────────────

func TestResolveHierarchy_DeletedManager_BlocksNewOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	softDeleteUser(t, db, managerID)

	_, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err == nil {
		t.Fatal("expected order creation to fail after the team's manager was deleted, got nil error")
	}
}

func TestResolveHierarchy_DeletedTeamLead_BlocksNewOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	softDeleteUser(t, db, teamLeadID)

	_, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err == nil {
		t.Fatal("expected order creation to fail after the team's team lead was deleted, got nil error")
	}
}

// ─── Inactive (deactivated, not deleted) manager / team lead must also block ──

func TestResolveHierarchy_InactiveManager_BlocksNewOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	deactivateUser(t, db, managerID)

	_, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err == nil {
		t.Fatal("expected order creation to fail after the team's manager was deactivated, got nil error")
	}
}

func TestResolveHierarchy_InactiveTeamLead_BlocksNewOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	deactivateUser(t, db, teamLeadID)

	_, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err == nil {
		t.Fatal("expected order creation to fail after the team's team lead was deactivated, got nil error")
	}
}

// ─── Regression guard: a team that never had management assigned must NOT
// be treated the same as a team whose management was removed. ────────────────

func TestResolveHierarchy_UnassignedManagerAndTeamLead_StillAllowsOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)

	seller := testutil.CreateUser(t, db, users.RoleSeller)
	team := &teams.Team{ID: uuid.New(), Name: "Unstaffed Team " + uuid.New().String()[:8], IsActive: true}
	if err := teamRepo.Create(context.Background(), team); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := hierRepo.Upsert(context.Background(), &hierarchy.UserHierarchy{
		ID: uuid.New(), UserID: seller.ID, TeamID: &team.ID,
	}); err != nil {
		t.Fatalf("assign seller hierarchy: %v", err)
	}

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, seller.ID, 100)

	order, err := svc.Create(context.Background(), seller.ID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err != nil {
		t.Fatalf("expected order creation to succeed for an unstaffed team, got error: %v", err)
	}
	if order.ManagerID != nil {
		t.Errorf("expected nil ManagerID for unstaffed team, got %v", order.ManagerID)
	}
	if order.TeamLeadID != nil {
		t.Errorf("expected nil TeamLeadID for unstaffed team, got %v", order.TeamLeadID)
	}
}

// ─── Historical orders must never be rewritten ───────────────────────────────

// TestResolveHierarchy_HistoryUntouched proves requirement 5: an order created
// BEFORE the manager/team-lead is deleted keeps its frozen manager_id,
// team_lead_id, and snapshot_id completely unchanged afterward — this fix
// only blocks FUTURE orders, it never rewrites historical data.
func TestResolveHierarchy_HistoryUntouched(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	managerID, teamLeadID, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	// Historical order, created while the manager/team-lead were still valid.
	historical, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err != nil {
		t.Fatalf("create historical order: %v", err)
	}
	if historical.ManagerID == nil || *historical.ManagerID != managerID {
		t.Fatalf("fixture setup: historical order manager_id = %v, want %s", historical.ManagerID, managerID)
	}
	if historical.TeamLeadID == nil || *historical.TeamLeadID != teamLeadID {
		t.Fatalf("fixture setup: historical order team_lead_id = %v, want %s", historical.TeamLeadID, teamLeadID)
	}
	snapshotIDBefore := historical.SnapshotID

	// Now delete the manager and team lead.
	softDeleteUser(t, db, managerID)
	softDeleteUser(t, db, teamLeadID)

	// A new order for the same team must now fail...
	if _, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID)); err == nil {
		t.Fatal("expected a new order to fail after manager+team lead deletion")
	}

	// ...but the historical order's frozen hierarchy and snapshot must be
	// completely unchanged.
	reloaded, err := svc.GetByID(context.Background(), historical.ID)
	if err != nil {
		t.Fatalf("reload historical order: %v", err)
	}
	if reloaded.ManagerID == nil || *reloaded.ManagerID != managerID {
		t.Errorf("historical order manager_id changed: got %v, want %s", reloaded.ManagerID, managerID)
	}
	if reloaded.TeamLeadID == nil || *reloaded.TeamLeadID != teamLeadID {
		t.Errorf("historical order team_lead_id changed: got %v, want %s", reloaded.TeamLeadID, teamLeadID)
	}
	if reloaded.SnapshotID == nil || snapshotIDBefore == nil || *reloaded.SnapshotID != *snapshotIDBefore {
		t.Errorf("historical order snapshot_id changed: got %v, want %v", reloaded.SnapshotID, snapshotIDBefore)
	}

	// The historical order was never delivered, so it must still have zero
	// financial_events — proving nothing was retroactively emitted for it.
	var eventCount int64
	if err := db.Table("financial_events").Where("order_id = ?", historical.ID).Count(&eventCount).Error; err != nil {
		t.Fatalf("count financial_events: %v", err)
	}
	if eventCount != 0 {
		t.Errorf("expected 0 financial_events for a non-delivered historical order, got %d", eventCount)
	}
}
