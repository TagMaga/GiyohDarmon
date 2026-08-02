package warehouses

// service_test.go — DB-backed tests for courier-warehouse inventory tracking
// (migration 00091): transfer issuance/accept/reject, self-assignment stock
// gating + reservation moves, full returns, and lost-product debt.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/warehouses/ -v

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// buildTestServices wires a real warehouses.Service against a real
// orders.Service, mirroring cmd/server/main.go's construction.
func buildTestServices(t *testing.T, db *gorm.DB) (*Service, *orders.Service) {
	t.Helper()
	invRepo := inventory.NewRepository(db, time.UTC)
	hierRepo := hierarchy.NewRepository(db)
	teamRepo := teams.NewRepository(db)
	activityLogger := activity.NewLogger(activity.NewRepository(db))
	compSvc := compensation.NewService(compensation.NewRepository(db), activityLogger, db, time.UTC)
	orderRepo := orders.NewRepository(db, time.UTC)
	userRepo := users.NewRepository(db)
	prodRepo := products.NewRepository(db)

	sellerLookup := func(ctx context.Context, id uuid.UUID) (*orders.SellerLookupResult, error) {
		u, err := userRepo.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if u == nil {
			return nil, nil
		}
		return &orders.SellerLookupResult{IsActive: u.IsActive, Role: string(u.Role)}, nil
	}
	orderSvc := orders.NewService(orderRepo, invRepo, hierRepo, teamRepo, compSvc, activityLogger, db, sellerLookup)

	whRepo := NewRepository(db)
	whSvc := NewService(whRepo, invRepo, orderSvc, prodRepo, userRepo, activityLogger, db)
	orderSvc.SetWarehouseAdapter(whSvc.AdjustForOrder)
	orderSvc.SetCourierDeliveryAdapter(whSvc.DeliverCourierItem)

	// Seed the default main warehouse (normally done by migration 00091;
	// each test DB is a fresh migrated schema so it already exists — this
	// is a defensive no-op insert in case a test runs against a schema
	// where the seed row was cleaned).
	db.Exec(`INSERT INTO warehouses (id, type, name, is_active) VALUES (?, 'main', 'Главный склад', true) ON CONFLICT DO NOTHING`, DefaultMainWarehouseID)

	return whSvc, orderSvc
}

func createTestCity(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec(`INSERT INTO cities (id, name, is_active) VALUES (?, ?, true)`, id, "Test City "+id.String()[:8]).Error; err != nil {
		t.Fatalf("create test city: %v", err)
	}
	return id
}

func createTestCustomer(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	repo := customers.NewRepository(db)
	c := &customers.Customer{ID: uuid.New(), FullName: "Test Customer", Phone: "+1" + uuid.New().String()[:9]}
	if err := repo.Create(context.Background(), c); err != nil {
		t.Fatalf("create test customer: %v", err)
	}
	return c.ID
}

// createSellerWithTeam creates a manager, team lead, team, and a seller
// belonging to that team (orders.Service.resolveHierarchy requires every
// seller to belong to a team before they can create an order).
func createSellerWithTeam(t *testing.T, db *gorm.DB) *users.User {
	t.Helper()
	manager := testutil.CreateUser(t, db, users.RoleManager)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	teamRepo := teams.NewRepository(db)
	team := &teams.Team{ID: uuid.New(), Name: "Test Team " + uuid.New().String()[:8], ManagerID: &manager.ID, TeamLeadID: &lead.ID, IsActive: true}
	if err := teamRepo.Create(context.Background(), team); err != nil {
		t.Fatalf("create test team: %v", err)
	}
	hierRepo := hierarchy.NewRepository(db)
	if err := hierRepo.Upsert(context.Background(), &hierarchy.UserHierarchy{ID: uuid.New(), UserID: seller.ID, ParentID: &manager.ID, TeamID: &team.ID}); err != nil {
		t.Fatalf("assign seller hierarchy: %v", err)
	}
	return seller
}

func createOrderForCourier(t *testing.T, db *gorm.DB, orderSvc *orders.Service, sellerID, productID uuid.UUID, qty int) *orders.Order {
	t.Helper()
	req := orders.CreateOrderRequest{
		CustomerID:     createTestCustomer(t, db),
		OrderType:      orders.OrderTypeSeller,
		CityID:         createTestCity(t, db),
		DeliveryMethod: "normal",
		Items:          []orders.OrderItemRequest{{ProductID: productID, Quantity: qty, UnitPrice: 100}},
	}
	o, err := orderSvc.Create(context.Background(), sellerID, "seller", req)
	if err != nil {
		t.Fatalf("create test order: %v", err)
	}
	return o
}

// ─── Transfers ──────────────────────────────────────────────────────────────

func TestCreateTransfer_MultipleProducts_BlocksMainStock(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p1 := testutil.CreateProduct(t, db)
	p2 := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p1.ID, owner.ID, 50)
	testutil.CreateInventory(t, db, p2.ID, owner.ID, 30)

	resp, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID,
		CourierID:       courier.ID,
		Items: []TransferItemRequest{
			{ProductID: p1.ID, Quantity: 10},
			{ProductID: p2.ID, Quantity: 5},
		},
	})
	if err != nil {
		t.Fatalf("expected transfer creation to succeed, got: %v", err)
	}
	if resp.Status != TransferIssued {
		t.Errorf("expected status issued, got %s", resp.Status)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(resp.Items))
	}

	var inv inventory.Inventory
	db.Where("product_id = ?", p1.ID).First(&inv)
	if inv.BlockedQuantity != 10 {
		t.Errorf("expected p1 blocked_quantity = 10, got %d", inv.BlockedQuantity)
	}
	if inv.AvailableQuantity != 40 {
		t.Errorf("expected p1 available_quantity = 40 (50-10 blocked), got %d", inv.AvailableQuantity)
	}
}

func TestCreateTransfer_InsufficientStock_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 5)

	_, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID,
		CourierID:       courier.ID,
		Items:           []TransferItemRequest{{ProductID: p.ID, Quantity: 10}},
	})
	if err == nil {
		t.Fatal("expected transfer to be rejected for insufficient stock")
	}

	var inv inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&inv)
	if inv.BlockedQuantity != 0 {
		t.Errorf("expected no stock blocked after a rejected transfer, got blocked=%d", inv.BlockedQuantity)
	}
}

func TestAcceptTransfer_MovesStockToCourierWarehouse_PreservesTotalQuantity(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}

	accepted, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)
	if err != nil {
		t.Fatalf("expected accept to succeed, got: %v", err)
	}
	if accepted.Status != TransferAccepted {
		t.Errorf("expected status accepted, got %s", accepted.Status)
	}

	var mainInv inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&mainInv)
	if mainInv.Quantity != 30 {
		t.Errorf("expected main quantity = 30 (50-20), got %d", mainInv.Quantity)
	}
	if mainInv.BlockedQuantity != 0 {
		t.Errorf("expected main blocked_quantity = 0 after acceptance, got %d", mainInv.BlockedQuantity)
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 20 {
		t.Errorf("expected courier warehouse quantity = 20, got %d", ci.Quantity)
	}

	// Total company-wide physical quantity must be preserved across the move.
	if mainInv.Quantity+ci.Quantity != 50 {
		t.Errorf("expected total quantity preserved at 50, got %d", mainInv.Quantity+ci.Quantity)
	}
}

func TestAcceptTransfer_Duplicate_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("first accept: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err == nil {
		t.Fatal("expected second acceptance of the same transfer to be rejected (no double-crediting)")
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 20 {
		t.Errorf("expected courier warehouse quantity to still be 20 after duplicate accept attempt, got %d", ci.Quantity)
	}
}

func TestRejectTransfer_ReleasesBlockedStock_CourierWarehouseUnchanged(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})

	rejected, err := whSvc.RejectTransfer(context.Background(), courier.ID, transfer.ID)
	if err != nil {
		t.Fatalf("expected reject to succeed, got: %v", err)
	}
	if rejected.Status != TransferRejected {
		t.Errorf("expected status rejected, got %s", rejected.Status)
	}

	var mainInv inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&mainInv)
	if mainInv.Quantity != 50 || mainInv.BlockedQuantity != 0 {
		t.Errorf("expected main quantity=50 blocked=0 after rejection, got quantity=%d blocked=%d", mainInv.Quantity, mainInv.BlockedQuantity)
	}

	var count int64
	db.Model(&CourierInventory{}).Where("product_id = ?", p.ID).Count(&count)
	if count > 0 {
		var ci CourierInventory
		db.Where("product_id = ?", p.ID).First(&ci)
		if ci.Quantity != 0 {
			t.Errorf("expected courier warehouse to remain unchanged (0) after rejection, got %d", ci.Quantity)
		}
	}
}

// ─── Self-assignment stock gating (spec section 5) ─────────────────────────

func TestReserveForClaim_InsufficientCourierStock_BlocksAssignment(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, seller.ID, 100)

	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)

	// Courier warehouse has no stock at all yet.
	err := db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	})
	if err == nil {
		t.Fatal("expected claim to be blocked: courier warehouse has no stock")
	}

	var item orders.OrderItem
	db.Where("order_id = ?", order.ID).First(&item)
	if item.ReservedWarehouseID != orders.MainWarehouseID {
		t.Error("expected reservation to remain at the main warehouse after a blocked claim")
	}
}

func TestReserveForClaim_SufficientStock_MovesReservationToCourierWarehouse(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	// Give the courier their own stock via an accepted transfer first.
	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)

	err = db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	})
	if err != nil {
		t.Fatalf("expected claim to succeed with sufficient courier stock, got: %v", err)
	}

	var item orders.OrderItem
	db.Where("order_id = ?", order.ID).First(&item)
	if item.ReservedWarehouseID == orders.MainWarehouseID {
		t.Error("expected reservation to move to the courier's warehouse")
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.ReservedQuantity != 5 {
		t.Errorf("expected courier warehouse reserved_quantity = 5, got %d", ci.ReservedQuantity)
	}

	var mainInv inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&mainInv)
	if mainInv.ReservedQuantity != 0 {
		t.Errorf("expected main reserved_quantity released to 0, got %d", mainInv.ReservedQuantity)
	}
}

func TestReserveForClaim_ReleasedOrder_MigratesReservationBetweenCouriers(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courierA := testutil.CreateUser(t, db, users.RoleCourier)
	courierB := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	for _, courier := range []*users.User{courierA, courierB} {
		transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
			FromWarehouseID: DefaultMainWarehouseID,
			CourierID:       courier.ID,
			Items:           []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
		})
		if err != nil {
			t.Fatalf("create transfer for %s: %v", courier.ID, err)
		}
		if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
			t.Fatalf("accept transfer for %s: %v", courier.ID, err)
		}
	}

	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)
	if err := db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courierA.ID, order.ID)
	}); err != nil {
		t.Fatalf("initial reserve for courier A: %v", err)
	}
	db.Exec(`UPDATE orders SET status = 'assigned', courier_id = ? WHERE id = ?`, courierA.ID, order.ID)
	db.Exec(`INSERT INTO order_assignments (id, order_id, courier_id, assigned_by, is_active) VALUES (?, ?, ?, ?, true)`,
		uuid.New(), order.ID, courierA.ID, owner.ID)

	if _, err := orderSvc.ChangeStatus(context.Background(), courierA.ID, "courier", order.ID, orders.ChangeStatusRequest{
		Status: orders.StatusConfirmed,
	}); err != nil {
		t.Fatalf("release order from courier A: %v", err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courierB.ID, order.ID)
	}); err != nil {
		t.Fatalf("reserve released order for courier B: %v", err)
	}

	var whA, whB Warehouse
	db.Where("courier_id = ?", courierA.ID).First(&whA)
	db.Where("courier_id = ?", courierB.ID).First(&whB)
	var invA, invB CourierInventory
	db.Where("warehouse_id = ? AND product_id = ?", whA.ID, p.ID).First(&invA)
	db.Where("warehouse_id = ? AND product_id = ?", whB.ID, p.ID).First(&invB)
	if invA.ReservedQuantity != 0 {
		t.Errorf("expected courier A reservation to be released, got %d", invA.ReservedQuantity)
	}
	if invB.ReservedQuantity != 5 {
		t.Errorf("expected courier B reservation to become 5, got %d", invB.ReservedQuantity)
	}
	var item orders.OrderItem
	db.Where("order_id = ?", order.ID).First(&item)
	if item.ReservedWarehouseID != whB.ID {
		t.Errorf("expected reservation warehouse %s, got %s", whB.ID, item.ReservedWarehouseID)
	}
}

// ─── Delivery, refusal, postponement (spec section 6) ──────────────────────

func TestDeliveredOrder_DeductsFromCourierWarehouse(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)
	if err := db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	}); err != nil {
		t.Fatalf("reserve for claim: %v", err)
	}

	// Manually move the order to assigned (skipping the full claim/assignment
	// plumbing, which is exercised in internal/courier) so ChangeStatus's
	// role/transition checks accept the assigned->delivered path.
	db.Exec(`UPDATE orders SET status = 'assigned', courier_id = ? WHERE id = ?`, courier.ID, order.ID)
	db.Exec(`INSERT INTO order_assignments (id, order_id, courier_id, assigned_by, is_active) VALUES (?, ?, ?, ?, true)`,
		uuid.New(), order.ID, courier.ID, courier.ID)

	if _, err := orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusInDelivery}); err != nil {
		t.Fatalf("transition to in_delivery: %v", err)
	}
	if _, err := orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusDelivered}); err != nil {
		t.Fatalf("transition to delivered: %v", err)
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 15 {
		t.Errorf("expected courier warehouse quantity = 15 (20-5 delivered), got %d", ci.Quantity)
	}
	if ci.ReservedQuantity != 0 {
		t.Errorf("expected courier warehouse reserved_quantity = 0 after delivery, got %d", ci.ReservedQuantity)
	}
}

// TestDeliveredOrder_CourierFIFOCost_MatchesInvoiceOrder is the exact
// scenario from the bug report: batch 1 is 10 units @ 40, batch 2 is 10
// units @ 50 (two separate накладные). A courier transfers all 20 units,
// then delivers an order for 12 of them. Product cost must be computed
// strictly FIFO by накладная order — 10 units from batch 1 (400) + 2 units
// from batch 2 (100) = 500 — never averaged.
func TestDeliveredOrder_CourierFIFOCost_MatchesInvoiceOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)

	// Batch 1: 10 units @ 40 (testutil.CreateInventory's fixed unit cost).
	testutil.CreateInventory(t, db, p.ID, owner.ID, 10)

	// Batch 2: 10 more units @ 50, received strictly after batch 1 so FIFO
	// order is unambiguous.
	batch2 := &inventory.Batch{
		ID:                uuid.New(),
		ProductID:         p.ID,
		ReceivedQuantity:  10,
		RemainingQuantity: 10,
		UnitCost:          50.0,
		ReceivedAt:        time.Now().UTC().Add(time.Hour),
		CreatedBy:         &owner.ID,
	}
	if err := db.Create(batch2).Error; err != nil {
		t.Fatalf("create batch 2: %v", err)
	}
	// Batch 3: unrelated buffer stock, received even later, so it's never
	// touched by the 20-unit transfer below — it exists only so the main
	// pool still has enough AVAILABLE quantity to reserve the order (12
	// units) both before and after those exact 20 units leave for the
	// courier (transfers only check physical availability, not whether
	// units are already reserved by some other order).
	batch3 := &inventory.Batch{
		ID:                uuid.New(),
		ProductID:         p.ID,
		ReceivedQuantity:  12,
		RemainingQuantity: 12,
		UnitCost:          99.0,
		ReceivedAt:        time.Now().UTC().Add(2 * time.Hour),
		CreatedBy:         &owner.ID,
	}
	if err := db.Create(batch3).Error; err != nil {
		t.Fatalf("create batch 3: %v", err)
	}
	if err := db.Model(&inventory.Inventory{}).Where("product_id = ?", p.ID).
		UpdateColumn("quantity", 32).Error; err != nil {
		t.Fatalf("bump inventory quantity for batches 2+3: %v", err)
	}

	// Reserve the order against the main pool first (12 of the 32 units),
	// mirroring real order creation, before any of its stock physically
	// moves to a courier.
	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 12)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	}); err != nil {
		t.Fatalf("reserve for claim: %v", err)
	}

	db.Exec(`UPDATE orders SET status = 'assigned', courier_id = ? WHERE id = ?`, courier.ID, order.ID)
	db.Exec(`INSERT INTO order_assignments (id, order_id, courier_id, assigned_by, is_active) VALUES (?, ?, ?, ?, true)`,
		uuid.New(), order.ID, courier.ID, courier.ID)

	if _, err := orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusInDelivery}); err != nil {
		t.Fatalf("transition to in_delivery: %v", err)
	}
	if _, err := orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusDelivered}); err != nil {
		t.Fatalf("transition to delivered: %v", err)
	}

	var productCost float64
	if err := db.Table("orders").Select("product_cost").Where("id = ?", order.ID).Scan(&productCost).Error; err != nil {
		t.Fatalf("fetch order product_cost: %v", err)
	}
	if productCost != 500 {
		t.Errorf("expected FIFO product_cost = 500 (10*40 + 2*50), got %v", productCost)
	}

	var b1Remaining, b2Remaining int
	db.Table("courier_inventory_batches").Where("unit_cost = 40").Select("remaining_quantity").Scan(&b1Remaining)
	db.Table("courier_inventory_batches").Where("unit_cost = 50").Select("remaining_quantity").Scan(&b2Remaining)
	if b1Remaining != 0 {
		t.Errorf("expected batch-1 (cost 40) courier lot fully consumed, got remaining=%d", b1Remaining)
	}
	if b2Remaining != 8 {
		t.Errorf("expected batch-2 (cost 50) courier lot to have 8 remaining, got %d", b2Remaining)
	}
}

func TestReturnedOrder_ReleasesReservation_KeepsPhysicalStockWithCourier(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)

	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)
	db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	})
	db.Exec(`UPDATE orders SET status = 'assigned', courier_id = ? WHERE id = ?`, courier.ID, order.ID)
	db.Exec(`INSERT INTO order_assignments (id, order_id, courier_id, assigned_by, is_active) VALUES (?, ?, ?, ?, true)`,
		uuid.New(), order.ID, courier.ID, courier.ID)
	orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusInDelivery})

	// Customer refusal is modeled as the "returned" status (see audit — no
	// distinct refusal status exists in the state machine).
	if _, err := orderSvc.ChangeStatus(context.Background(), courier.ID, "courier", order.ID, orders.ChangeStatusRequest{Status: orders.StatusReturned}); err != nil {
		t.Fatalf("transition to returned: %v", err)
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 20 {
		t.Errorf("expected physical stock to stay with the courier (20), got %d", ci.Quantity)
	}
	if ci.ReservedQuantity != 0 {
		t.Errorf("expected reservation released (0), got %d", ci.ReservedQuantity)
	}
	if ci.AvailableQuantity != 20 {
		t.Errorf("expected the full 20 to be free/available again, got %d", ci.AvailableQuantity)
	}
}

// ─── Full returns (spec section 8) ──────────────────────────────────────────

func TestCreateFullReturn_NoManualQuantity_BlocksFreeStockOnly(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)

	// 5 units stay reserved for an active order — must NOT be included in the return.
	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 5)
	db.Transaction(func(tx *gorm.DB) error {
		return whSvc.ReserveForClaim(tx, context.Background(), courier.ID, order.ID)
	})

	ret, err := whSvc.CreateFullReturn(context.Background(), courier.ID, CreateReturnRequest{ToWarehouseID: DefaultMainWarehouseID})
	if err != nil {
		t.Fatalf("expected full return to succeed, got: %v", err)
	}
	if len(ret.Items) != 1 || ret.Items[0].Quantity != 15 {
		t.Fatalf("expected the return to cover exactly the free 15 units (20-5 reserved), got %+v", ret.Items)
	}

	// A second return request while one is pending must be rejected —
	// partial/duplicate returns are not allowed.
	if _, err := whSvc.CreateFullReturn(context.Background(), courier.ID, CreateReturnRequest{ToWarehouseID: DefaultMainWarehouseID}); err == nil {
		t.Fatal("expected a second concurrent return request to be rejected")
	}
}

func TestAcceptReturn_MovesStockToMainWarehouse_NeverSimultaneouslyAvailable(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)

	ret, err := whSvc.CreateFullReturn(context.Background(), courier.ID, CreateReturnRequest{ToWarehouseID: DefaultMainWarehouseID})
	if err != nil {
		t.Fatalf("create return: %v", err)
	}

	// While the return is pending, the stock is blocked at the courier and
	// not yet added back at main — never available in both places at once.
	var ciPending CourierInventory
	db.Where("product_id = ?", p.ID).First(&ciPending)
	if ciPending.AvailableQuantity != 0 {
		t.Errorf("expected courier available_quantity = 0 while return is pending, got %d", ciPending.AvailableQuantity)
	}
	var mainPending inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&mainPending)
	if mainPending.Quantity != 80 {
		t.Errorf("expected main quantity still 80 (unchanged) while return pending, got %d", mainPending.Quantity)
	}

	accepted, err := whSvc.AcceptReturn(context.Background(), owner.ID, ret.ID)
	if err != nil {
		t.Fatalf("expected accept return to succeed, got: %v", err)
	}
	if accepted.Status != ReturnAccepted {
		t.Errorf("expected status accepted, got %s", accepted.Status)
	}

	var ciAfter CourierInventory
	db.Where("product_id = ?", p.ID).First(&ciAfter)
	if ciAfter.Quantity != 0 {
		t.Errorf("expected courier quantity = 0 after accepted return, got %d", ciAfter.Quantity)
	}
	var mainAfter inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&mainAfter)
	if mainAfter.Quantity != 100 {
		t.Errorf("expected main quantity restored to 100, got %d", mainAfter.Quantity)
	}
}

// ─── Lost product debt (spec section 9) ─────────────────────────────────────

func TestLostReport_ApprovedDebt_ExcludesDeliveryFee(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db) // PurchasePrice = 40, SalePrice = 100 (see testutil.CreateProduct)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 10}},
	})
	whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)

	report, err := whSvc.CreateLostReport(context.Background(), courier.ID, CreateLostReportRequest{
		ProductID: p.ID, Quantity: 3, PhotoURL: "https://example.com/photo.jpg", Comment: "dropped in the river",
	})
	if err != nil {
		t.Fatalf("expected lost report creation to succeed, got: %v", err)
	}
	if report.Status != LostReportPending {
		t.Errorf("expected pending status before approval, got %s", report.Status)
	}

	decided, err := whSvc.DecideLostReport(context.Background(), owner.ID, report.ID, DecideLostReportRequest{Approve: true})
	if err != nil {
		t.Fatalf("expected approval to succeed, got: %v", err)
	}
	// debt = unit purchase cost (40) * quantity (3) = 120 — the sale price
	// (100/unit) and any delivery fee must never enter this calculation.
	if decided.DebtAmount != 120 {
		t.Errorf("expected debt_amount = 120 (cost-only, 3 x 40), got %v", decided.DebtAmount)
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 7 {
		t.Errorf("expected courier warehouse quantity = 7 (10-3 lost), got %d", ci.Quantity)
	}
}

func TestLostReport_Rejected_NoDeduction(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, _ := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 10}},
	})
	whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID)

	report, _ := whSvc.CreateLostReport(context.Background(), courier.ID, CreateLostReportRequest{
		ProductID: p.ID, Quantity: 3, PhotoURL: "https://example.com/photo.jpg", Comment: "test",
	})
	if _, err := whSvc.DecideLostReport(context.Background(), owner.ID, report.ID, DecideLostReportRequest{Approve: false}); err != nil {
		t.Fatalf("reject lost report: %v", err)
	}

	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.Quantity != 10 {
		t.Errorf("expected no deduction after rejection, got quantity=%d", ci.Quantity)
	}
	if ci.AvailableQuantity != 10 {
		t.Errorf("expected the blocked quantity released back to available, got available=%d", ci.AvailableQuantity)
	}
}

// ─── Concurrency: two transfers racing the same product can't over-allocate ─

func TestConcurrentTransfers_CannotOverAllocateSameStock(t *testing.T) {
	// Uses testutil.DB (the shared disposable DB, real connection pool) rather
	// than NewTestDB (a single transaction/connection per test) — genuine
	// concurrent goroutines need separate connections, which a single
	// in-flight transaction can't hand out. Data written here is not rolled
	// back; it's dropped along with the whole disposable DB when the test
	// binary exits (see testutil.Main).
	db := testutil.DB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courierA := testutil.CreateUser(t, db, users.RoleCourier)
	courierB := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 10)

	var wg sync.WaitGroup
	results := make([]error, 2)
	couriers := []uuid.UUID{courierA.ID, courierB.ID}
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
				FromWarehouseID: DefaultMainWarehouseID, CourierID: couriers[i],
				Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 8}},
			})
			results[i] = err
		}(i)
	}
	wg.Wait()

	successes := 0
	for _, err := range results {
		if err == nil {
			successes++
		} else {
			t.Logf("transfer error (expected for exactly one of two): %v", err)
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly 1 of 2 concurrent 8-unit transfers against 10 units of stock to succeed, got %d", successes)
	}

	var inv inventory.Inventory
	db.Where("product_id = ?", p.ID).First(&inv)
	if inv.BlockedQuantity != 8 {
		t.Errorf("expected blocked_quantity = 8 (only the winning transfer), got %d", inv.BlockedQuantity)
	}
	if inv.AvailableQuantity < 0 {
		t.Errorf("available_quantity must never go negative, got %d", inv.AvailableQuantity)
	}
}

// ─── Dispatcher recall after a transfer moved the reservation ──────────────
//
// A recall must never be blocked merely because main stock is depleted.
// The reservation stays in the warehouse that physically holds the product
// until the next courier claim/assignment atomically migrates it.
func TestRecallAfterTransferMove_MainStockDepleted_StillReleasesCourier(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, orderSvc := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	seller := createSellerWithTeam(t, db)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 20)

	// Order created and reserved at main (no self-claim — simulates a
	// dispatcher-direct assignment, which never calls ReserveForClaim).
	order := createOrderForCourier(t, db, orderSvc, seller.ID, p.ID, 3)
	db.Exec(`UPDATE orders SET status = 'assigned', courier_id = ? WHERE id = ?`, courier.ID, order.ID)
	db.Exec(`INSERT INTO order_assignments (id, order_id, courier_id, assigned_by, is_active) VALUES (?, ?, ?, ?, true)`,
		uuid.New(), order.ID, courier.ID, courier.ID)

	// A transfer of the same product is issued and accepted — its
	// acceptance sweeps the order's reservation into the courier warehouse.
	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 10}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	var item orders.OrderItem
	db.Where("order_id = ?", order.ID).First(&item)
	if item.ReservedWarehouseID == orders.MainWarehouseID {
		t.Fatal("expected the order's reservation to have moved to the courier warehouse via transfer acceptance")
	}

	// Deplete main stock: quantity is now 10 (20-10 transferred), reserved 0
	// (moved away). Write off down to less than the 3 units the recall will
	// need to restore.
	invRepo := inventory.NewRepository(db, time.UTC)
	mainInv, err := invRepo.GetOrCreateForUpdate(db, context.Background(), p.ID)
	if err != nil {
		t.Fatalf("lock main inventory: %v", err)
	}
	if err := invRepo.UpdateQuantity(db, context.Background(), mainInv.ID, 1); err != nil {
		t.Fatalf("deplete main stock: %v", err)
	}

	// Recall: dispatcher moves the order back to confirmed even though main
	// cannot currently back a replacement reservation.
	_, err = orderSvc.ChangeStatus(context.Background(), owner.ID, "dispatcher", order.ID, orders.ChangeStatusRequest{
		Status: orders.StatusConfirmed,
	})
	if err != nil {
		t.Fatalf("recall must succeed despite depleted main stock: %v", err)
	}

	// The assignment is released while the reservation remains where the
	// physical stock is held.
	var afterOrder orders.Order
	db.Where("id = ?", order.ID).First(&afterOrder)
	if afterOrder.Status != orders.StatusConfirmed {
		t.Errorf("expected order to return to confirmed, got %q", afterOrder.Status)
	}
	if afterOrder.CourierID != nil {
		t.Errorf("expected courier cache to be cleared, got %v", afterOrder.CourierID)
	}
	var activeAssignments int64
	db.Table("order_assignments").
		Where("order_id = ? AND is_active = TRUE", order.ID).
		Count(&activeAssignments)
	if activeAssignments != 0 {
		t.Errorf("expected no active assignment, got %d", activeAssignments)
	}
	var ci CourierInventory
	db.Where("product_id = ?", p.ID).First(&ci)
	if ci.ReservedQuantity != 3 {
		t.Errorf("expected physical courier reservation to remain 3, got %d", ci.ReservedQuantity)
	}
	db.Where("order_id = ?", order.ID).First(&item)
	if item.ReservedWarehouseID == orders.MainWarehouseID {
		t.Error("reservation must not move to depleted main warehouse")
	}
	var mainAfter inventory.Inventory
	db.Where("id = ?", mainInv.ID).First(&mainAfter)
	if mainAfter.AvailableQuantity < 0 {
		t.Fatalf("main available_quantity must never go negative, got %d", mainAfter.AvailableQuantity)
	}
}

// ─── Inventory summary (owner dashboard) ────────────────────────────────────

func TestGetInventorySummary_AggregatesBothLedgersCorrectly(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)

	// Baseline before this test's own data — other tests in this package
	// (e.g. the concurrency test) intentionally use testutil.DB, a real
	// non-transactional connection, so their committed rows are visible
	// here too; assert on the delta, not absolute totals.
	before, err := whSvc.GetInventorySummary(context.Background())
	if err != nil {
		t.Fatalf("get baseline inventory summary: %v", err)
	}

	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	after, err := whSvc.GetInventorySummary(context.Background())
	if err != nil {
		t.Fatalf("get inventory summary: %v", err)
	}
	// A prior bug reused one destination struct across two Raw().Scan()
	// calls, silently zeroing the first query's main_* fields — this
	// guards against that regression.
	if got := after.MainQuantity - before.MainQuantity; got != 30 {
		t.Errorf("expected main_quantity delta = 30 (50-20 transferred), got %d", got)
	}
	if got := after.CourierQuantity - before.CourierQuantity; got != 20 {
		t.Errorf("expected courier_quantity delta = 20, got %d", got)
	}
}

func TestGetInventoryDistribution_ListsMainAndCourierBalances(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID,
		CourierID:       courier.ID,
		Items:           []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	distribution, err := whSvc.GetInventoryDistribution(context.Background())
	if err != nil {
		t.Fatalf("get inventory distribution: %v", err)
	}

	var courierWarehouseID uuid.UUID
	for _, location := range distribution.Locations {
		if location.CourierID != nil && *location.CourierID == courier.ID {
			courierWarehouseID = location.ID
			break
		}
	}
	if courierWarehouseID == uuid.Nil {
		t.Fatal("expected courier warehouse in distribution locations")
	}

	var mainQty, courierQty int
	for _, item := range distribution.Items {
		if item.ProductID != p.ID {
			continue
		}
		switch item.WarehouseID {
		case DefaultMainWarehouseID:
			mainQty = item.Quantity
		case courierWarehouseID:
			courierQty = item.Quantity
		}
	}
	if mainQty != 30 {
		t.Errorf("expected main product quantity 30, got %d", mainQty)
	}
	if courierQty != 20 {
		t.Errorf("expected courier product quantity 20, got %d", courierQty)
	}
}

// ─── Lost report status filtering (owner dashboard panel) ──────────────────

func TestListLostReports_FiltersByStatus(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 100)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 10}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	pending, err := whSvc.CreateLostReport(context.Background(), courier.ID, CreateLostReportRequest{
		ProductID: p.ID, Quantity: 1, PhotoURL: "https://example.com/a.jpg", Comment: "stays pending",
	})
	if err != nil {
		t.Fatalf("create pending report: %v", err)
	}
	decided, err := whSvc.CreateLostReport(context.Background(), courier.ID, CreateLostReportRequest{
		ProductID: p.ID, Quantity: 1, PhotoURL: "https://example.com/b.jpg", Comment: "gets approved",
	})
	if err != nil {
		t.Fatalf("create report to approve: %v", err)
	}
	if _, err := whSvc.DecideLostReport(context.Background(), owner.ID, decided.ID, DecideLostReportRequest{Approve: true}); err != nil {
		t.Fatalf("approve report: %v", err)
	}

	// A prior bug: the "pending" filter the owner dashboard panel relies on
	// was silently ignored end-to-end (handler never read the query param),
	// so an approved/rejected report never left the "awaiting decision" list.
	rows, total, err := whSvc.ListLostReports(context.Background(), string(LostReportPending), nil, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("list pending reports: %v", err)
	}
	if total != 1 || len(rows) != 1 || rows[0].ID != pending.ID {
		t.Fatalf("expected exactly the 1 still-pending report, got total=%d rows=%v", total, rows)
	}

	allRows, allTotal, err := whSvc.ListLostReports(context.Background(), "", nil, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("list all reports: %v", err)
	}
	if allTotal != 2 || len(allRows) != 2 {
		t.Fatalf("expected 2 reports with no status filter, got total=%d rows=%d", allTotal, len(allRows))
	}
}
