package dispatch

// courier_capacity_test.go — DB-backed QA for the per-courier max
// active-order limit (courier_max_active_orders): AssignCourier/
// ReassignCourier must reject once a courier holds that many active
// (assigned/in_delivery/issue) orders, and stay unlimited when unset.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/dispatch/ -v -run TestAssignCourier_|TestReassignCourier_

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

// setupCapacityCourier creates an active courier with a flat payout profile
// configured, so logistics_settings.ResolveAssignmentPayout (called inside
// AssignCourier/ReassignCourier) succeeds regardless of the capacity check
// under test.
func setupCapacityCourier(t *testing.T, db *gorm.DB) *users.User {
	t.Helper()
	c := testutil.CreateUser(t, db, users.RoleCourier)
	if err := db.Exec(
		"INSERT INTO courier_profiles (user_id, payout_normal, payout_fast, is_active) VALUES (?, 10, 15, true)",
		c.ID,
	).Error; err != nil {
		t.Fatalf("create courier profile: %v", err)
	}
	return c
}

// createConfirmedOrder inserts a minimal confirmed order (no city, so the
// city-service guard in ResolveAssignmentPayout is skipped) directly,
// bypassing orders.Service's full creation lifecycle — not the concern here.
func createConfirmedOrder(t *testing.T, db *gorm.DB, sellerID uuid.UUID) *orders.Order {
	t.Helper()
	custRepo := customers.NewRepository(db)
	cust := &customers.Customer{
		ID:       uuid.New(),
		FullName: "Test Customer",
		Phone:    "+1" + uuid.New().String()[:9],
	}
	if err := custRepo.Create(context.Background(), cust); err != nil {
		t.Fatalf("create test customer: %v", err)
	}
	o := &orders.Order{
		ID:          uuid.New(),
		CustomerID:  cust.ID,
		SellerID:    sellerID,
		OrderType:   orders.OrderTypeSeller,
		Status:      orders.StatusConfirmed,
		TotalAmount: 100,
		DeliveryFee: 10,
	}
	if err := db.Table("orders").Create(o).Error; err != nil {
		t.Fatalf("create confirmed order: %v", err)
	}
	return o
}

func setMaxActiveOrders(t *testing.T, db *gorm.DB, courierID uuid.UUID, max int) {
	t.Helper()
	if err := db.Model(&users.User{}).Where("id = ?", courierID).
		Update("courier_max_active_orders", max).Error; err != nil {
		t.Fatalf("set courier max active orders: %v", err)
	}
}

func TestAssignCourier_RespectsMaxActiveOrders(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &Service{repo: NewRepository(db), logger: activity.NewLogger(activity.NewRepository(db)), db: db}

	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)
	courier := setupCapacityCourier(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	ctx := context.Background()

	const limit = 2
	setMaxActiveOrders(t, db, courier.ID, limit)

	for i := 0; i < limit; i++ {
		o := createConfirmedOrder(t, db, seller.ID)
		if _, err := svc.AssignCourier(ctx, dispatcher.ID, o.ID, AssignCourierRequest{CourierID: courier.ID}); err != nil {
			t.Fatalf("assignment %d/%d should succeed, got: %v", i+1, limit, err)
		}
	}

	over := createConfirmedOrder(t, db, seller.ID)
	_, err := svc.AssignCourier(ctx, dispatcher.ID, over.ID, AssignCourierRequest{CourierID: courier.ID})
	if err == nil {
		t.Fatal("expected assignment beyond the limit to be rejected")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	if appErr.StatusCode != 409 {
		t.Fatalf("expected 409 Conflict, got %d: %v", appErr.StatusCode, appErr)
	}

	var status string
	if err := db.Table("orders").Where("id = ?", over.ID).Pluck("status", &status).Error; err != nil {
		t.Fatalf("reload order: %v", err)
	}
	if status != string(orders.StatusConfirmed) {
		t.Fatalf("order should remain confirmed (unassigned) after rejected assignment, got %q", status)
	}
}

func TestAssignCourier_UnlimitedByDefault(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &Service{repo: NewRepository(db), logger: activity.NewLogger(activity.NewRepository(db)), db: db}

	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)
	courier := setupCapacityCourier(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	ctx := context.Background()

	// No courier_max_active_orders set (nil) — assigning well beyond the old
	// hardcoded UI gauge of 6 must still succeed.
	for i := 0; i < 8; i++ {
		o := createConfirmedOrder(t, db, seller.ID)
		if _, err := svc.AssignCourier(ctx, dispatcher.ID, o.ID, AssignCourierRequest{CourierID: courier.ID}); err != nil {
			t.Fatalf("assignment %d should succeed when unlimited, got: %v", i+1, err)
		}
	}
}

func TestReassignCourier_RespectsMaxActiveOrders(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &Service{repo: NewRepository(db), logger: activity.NewLogger(activity.NewRepository(db)), db: db}

	dispatcher := testutil.CreateUser(t, db, users.RoleDispatcher)
	fullCourier := setupCapacityCourier(t, db)
	otherCourier := setupCapacityCourier(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	ctx := context.Background()

	setMaxActiveOrders(t, db, fullCourier.ID, 1)

	o1 := createConfirmedOrder(t, db, seller.ID)
	if _, err := svc.AssignCourier(ctx, dispatcher.ID, o1.ID, AssignCourierRequest{CourierID: fullCourier.ID}); err != nil {
		t.Fatalf("initial assignment filling fullCourier's only slot should succeed: %v", err)
	}

	o2 := createConfirmedOrder(t, db, seller.ID)
	if _, err := svc.AssignCourier(ctx, dispatcher.ID, o2.ID, AssignCourierRequest{CourierID: otherCourier.ID}); err != nil {
		t.Fatalf("assigning a second order to a different courier should succeed: %v", err)
	}

	_, err := svc.ReassignCourier(ctx, dispatcher.ID, o2.ID, AssignCourierRequest{CourierID: fullCourier.ID})
	if err == nil {
		t.Fatal("expected reassignment onto an already-at-capacity courier to be rejected")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	if appErr.StatusCode != 409 {
		t.Fatalf("expected 409 Conflict, got %d: %v", appErr.StatusCode, appErr)
	}
}

// TestUpdateCourier_MaxActiveOrders_SetClearReject exercises the dispatcher
// edit-courier save path (the "Изменить курьера" modal's backing endpoint):
// setting a limit, clearing it back to unlimited, and rejecting an invalid
// (<1) value.
func TestUpdateCourier_MaxActiveOrders_SetClearReject(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &Service{repo: NewRepository(db), logger: activity.NewLogger(activity.NewRepository(db)), db: db}

	courier := testutil.CreateUser(t, db, users.RoleCourier)
	ctx := context.Background()

	baseReq := UpdateCourierRequest{FullName: courier.FullName, Phone: courier.Phone}

	// Reject zero/negative.
	zero := 0
	reqZero := baseReq
	reqZero.MaxActiveOrders = &zero
	if _, err := svc.UpdateCourier(ctx, courier.ID, reqZero); err == nil {
		t.Fatal("expected max_active_orders=0 to be rejected")
	}

	// Set a limit.
	five := 5
	reqSet := baseReq
	reqSet.MaxActiveOrders = &five
	updated, err := svc.UpdateCourier(ctx, courier.ID, reqSet)
	if err != nil {
		t.Fatalf("setting max_active_orders=5 should succeed: %v", err)
	}
	if updated.MaxActiveOrders == nil || *updated.MaxActiveOrders != 5 {
		t.Fatalf("expected MaxActiveOrders=5 in response, got %v", updated.MaxActiveOrders)
	}

	// Confirm it surfaces in the board's courier overview too.
	overview, err := svc.GetCouriersOverview(ctx)
	if err != nil {
		t.Fatalf("get couriers overview: %v", err)
	}
	found := false
	for _, o := range overview {
		if o.CourierID == courier.ID {
			found = true
			if o.MaxActiveOrders == nil || *o.MaxActiveOrders != 5 {
				t.Fatalf("expected overview MaxActiveOrders=5, got %v", o.MaxActiveOrders)
			}
		}
	}
	if !found {
		t.Fatal("courier not present in GetCouriersOverview")
	}

	// Clear back to unlimited.
	reqClear := baseReq
	reqClear.MaxActiveOrders = nil
	updated, err = svc.UpdateCourier(ctx, courier.ID, reqClear)
	if err != nil {
		t.Fatalf("clearing max_active_orders should succeed: %v", err)
	}
	if updated.MaxActiveOrders != nil {
		t.Fatalf("expected MaxActiveOrders to be cleared (nil), got %v", *updated.MaxActiveOrders)
	}
}
