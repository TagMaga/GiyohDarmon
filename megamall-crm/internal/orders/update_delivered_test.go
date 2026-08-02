package orders

// update_delivered_test.go — DB-backed tests for Service.Update's delivered-order
// gate: manager / sales_team_lead / seller must be rejected once an order is
// delivered, while owner and dispatcher may still edit it.
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil).
// Run with: DB_DSN=... go test ./internal/orders/ -v -run TestUpdate_Delivered

import (
	"context"
	"testing"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func TestUpdate_DeliveredOrder_RejectedForManagerTeamLeadSeller(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	_, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	req := buildOrderRequest(customerID, cityID, product.ID)
	order, err := svc.Create(context.Background(), sellerID, "seller", req)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	if err := db.Table("orders").Where("id = ?", order.ID).
		Update("status", string(StatusDelivered)).Error; err != nil {
		t.Fatalf("force order to delivered: %v", err)
	}

	notes := "attempted edit after delivery"
	for _, role := range []string{"seller", "manager", "sales_team_lead"} {
		t.Run(role, func(t *testing.T) {
			_, err := svc.Update(context.Background(), sellerID, role, order.ID, UpdateOrderRequest{Notes: &notes})
			if err == nil {
				t.Fatalf("role %q: expected delivered order update to be rejected, got nil error", role)
			}
		})
	}
}

func TestUpdate_DeliveredOrder_AllowedForOwnerAndDispatcher(t *testing.T) {
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
		t.Fatalf("create order: %v", err)
	}

	if err := db.Table("orders").Where("id = ?", order.ID).
		Update("status", string(StatusDelivered)).Error; err != nil {
		t.Fatalf("force order to delivered: %v", err)
	}

	for _, role := range []string{"owner", "dispatcher"} {
		t.Run(role, func(t *testing.T) {
			notes := "edit as " + role
			updated, err := svc.Update(context.Background(), owner.ID, role, order.ID, UpdateOrderRequest{Notes: &notes})
			if err != nil {
				t.Fatalf("role %q: expected delivered order update to succeed, got error: %v", role, err)
			}
			if updated.Notes == nil || *updated.Notes != notes {
				t.Errorf("role %q: expected notes to be updated to %q, got %v", role, notes, updated.Notes)
			}
		})
	}
}
