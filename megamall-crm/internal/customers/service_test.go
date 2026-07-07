package customers

// service_test.go — IDOR scoping tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Each test
// runs inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/customers/ -v -run TestCustomers

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

var customerPhoneCounter atomic.Uint64

// createCustomer inserts a minimal customer row and returns it.
func createCustomer(t *testing.T, db *gorm.DB) *Customer {
	t.Helper()
	seq := customerPhoneCounter.Add(1)
	c := &Customer{
		ID:       uuid.New(),
		FullName: "Test Customer",
		Phone:    fmt.Sprintf("+3%09d", seq%1_000_000_000),
	}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("testutil: create customer: %v", err)
	}
	return c
}

// testOrder is a minimal stand-in for orders.Order, avoided as a direct
// import — internal/orders imports internal/teams and internal/hierarchy,
// and pulling that in here for tests only would risk import cycles as those
// packages grow their own test dependencies. It maps onto the same "orders"
// table and sets only the columns customer-scoping cares about.
type testOrder struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	CustomerID uuid.UUID  `gorm:"column:customer_id"`
	SellerID   uuid.UUID  `gorm:"column:seller_id"`
	ManagerID  *uuid.UUID `gorm:"column:manager_id"`
	TeamLeadID *uuid.UUID `gorm:"column:team_lead_id"`
	OrderType  string     `gorm:"column:order_type"`
	Status     string     `gorm:"column:status"`
}

func (testOrder) TableName() string { return "orders" }

func createOrder(t *testing.T, db *gorm.DB, customerID, sellerID uuid.UUID, managerID, teamLeadID *uuid.UUID) {
	t.Helper()
	o := &testOrder{
		ID:         uuid.New(),
		CustomerID: customerID,
		SellerID:   sellerID,
		ManagerID:  managerID,
		TeamLeadID: teamLeadID,
		OrderType:  "seller_order",
		Status:     "new",
	}
	if err := db.Create(o).Error; err != nil {
		t.Fatalf("testutil: create order: %v", err)
	}
}

func newTestService(db *gorm.DB) *Service {
	return NewService(NewRepository(db), activity.NewLogger(activity.NewRepository(db)))
}

func notFoundCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestCustomers_Owner_CanAccessAll(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	cust := createCustomer(t, db)
	createOrder(t, db, cust.ID, seller.ID, nil, nil)

	got, err := svc.GetByID(ctx, owner.ID, "owner", cust.ID)
	if err != nil {
		t.Fatalf("owner GetByID: %v", err)
	}
	if got.ID != cust.ID {
		t.Fatalf("got customer %s, want %s", got.ID, cust.ID)
	}

	// Owner sees even a customer with no orders at all.
	orphan := createCustomer(t, db)
	got, err = svc.GetByID(ctx, owner.ID, "owner", orphan.ID)
	if err != nil {
		t.Fatalf("owner GetByID orphan: %v", err)
	}
	if got.ID != orphan.ID {
		t.Fatal("owner should see a customer with no orders")
	}

	list, _, err := svc.List(ctx, owner.ID, "owner", ListCustomersFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("owner List: %v", err)
	}
	seen := map[uuid.UUID]bool{}
	for _, c := range list {
		seen[c.ID] = true
	}
	if !seen[cust.ID] || !seen[orphan.ID] {
		t.Fatal("owner's list should include both customers")
	}
}

func TestCustomers_Seller_OwnOrderAllowed(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	seller := testutil.CreateUser(t, db, users.RoleSeller)
	cust := createCustomer(t, db)
	createOrder(t, db, cust.ID, seller.ID, nil, nil)

	got, err := svc.GetByID(ctx, seller.ID, "seller", cust.ID)
	if err != nil {
		t.Fatalf("expected seller to access customer from their own order: %v", err)
	}
	if got.ID != cust.ID {
		t.Fatalf("got customer %s, want %s", got.ID, cust.ID)
	}

	list, _, err := svc.List(ctx, seller.ID, "seller", ListCustomersFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("seller List: %v", err)
	}
	found := false
	for _, c := range list {
		if c.ID == cust.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("seller's customer list did not include the customer from their own order")
	}
}

func TestCustomers_Seller_AnotherSellersCustomerDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	sellerA := testutil.CreateUser(t, db, users.RoleSeller)
	sellerB := testutil.CreateUser(t, db, users.RoleSeller)
	cust := createCustomer(t, db)
	createOrder(t, db, cust.ID, sellerB.ID, nil, nil)

	_, err := svc.GetByID(ctx, sellerA.ID, "seller", cust.ID)
	if err == nil {
		t.Fatal("expected seller A to be denied access to seller B's customer")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	list, _, err := svc.List(ctx, sellerA.ID, "seller", ListCustomersFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("seller A List: %v", err)
	}
	for _, c := range list {
		if c.ID == cust.ID {
			t.Fatal("seller A's list leaked seller B's customer")
		}
	}

	// Defense in depth: Update must also be denied, not just reads.
	newName := "Renamed By Attacker"
	_, err = svc.Update(ctx, sellerA.ID, "seller", cust.ID, UpdateCustomerRequest{FullName: &newName})
	if err == nil {
		t.Fatal("expected seller A to be denied updating seller B's customer")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

func TestCustomers_Manager_SeesTeamOrders(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	manager := testutil.CreateUser(t, db, users.RoleManager)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	otherManager := testutil.CreateUser(t, db, users.RoleManager)

	custManaged := createCustomer(t, db)
	createOrder(t, db, custManaged.ID, seller.ID, &manager.ID, nil)

	custOutsideSubtree := createCustomer(t, db)
	createOrder(t, db, custOutsideSubtree.ID, seller.ID, &otherManager.ID, nil)

	got, err := svc.GetByID(ctx, manager.ID, "manager", custManaged.ID)
	if err != nil {
		t.Fatalf("expected manager to access customer from their subtree: %v", err)
	}
	if got.ID != custManaged.ID {
		t.Fatalf("got customer %s, want %s", got.ID, custManaged.ID)
	}

	_, err = svc.GetByID(ctx, manager.ID, "manager", custOutsideSubtree.ID)
	if err == nil {
		t.Fatal("expected manager to be denied a customer outside their subtree")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

func TestCustomers_TeamLead_SeesTeamOrders(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	otherLead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)

	custInTeam := createCustomer(t, db)
	createOrder(t, db, custInTeam.ID, seller.ID, nil, &lead.ID)

	custOtherTeam := createCustomer(t, db)
	createOrder(t, db, custOtherTeam.ID, seller.ID, nil, &otherLead.ID)

	got, err := svc.GetByID(ctx, lead.ID, "sales_team_lead", custInTeam.ID)
	if err != nil {
		t.Fatalf("expected team lead to access customer from their team's order: %v", err)
	}
	if got.ID != custInTeam.ID {
		t.Fatalf("got customer %s, want %s", got.ID, custInTeam.ID)
	}

	_, err = svc.GetByID(ctx, lead.ID, "sales_team_lead", custOtherTeam.ID)
	if err == nil {
		t.Fatal("expected team lead to be denied a customer from another team")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

// TestCustomers_WarehouseManager_AccessDenied documents that
// warehouse_manager has no customer read access at all (removed entirely
// from readRoles in routes.go) — the role doesn't need customer PII for
// inventory/warehouse work, so it's withheld rather than scoped down. This
// test exercises the RBAC gate directly since RegisterRoutes is the actual
// enforcement point (the service has no concept of "warehouse_manager").
func TestCustomers_WarehouseManager_AccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	router := buildTestRouter(NewHandler(newTestService(db)))

	code := getAsRole(router, "/customers", "warehouse_manager")
	if code != 403 {
		t.Fatalf("warehouse_manager GET /customers: got %d, want 403", code)
	}
}
