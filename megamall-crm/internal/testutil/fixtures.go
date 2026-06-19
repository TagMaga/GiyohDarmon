package testutil

// fixtures.go — Minimal object creation helpers for unit/integration tests.
//
// These create the bare minimum required to satisfy FK constraints.
// They do NOT replace the seed command for full E2E setup.

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/internal/warehouse"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// CreateUser inserts a test user with the given role and returns it.
// Uses a random UUID and a deterministic phone derived from a counter.
func CreateUser(t *testing.T, db *gorm.DB, role users.Role) *users.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("testutil: hash password: %v", err)
	}
	u := &users.User{
		ID:           uuid.New(),
		Phone:        fmt.Sprintf("+0%d", time.Now().UnixNano()),
		PasswordHash: string(hash),
		FullName:     "Test " + string(role),
		Role:         role,
		IsActive:     true,
	}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("testutil: create user: %v", err)
	}
	return u
}

// CreateWarehouse inserts a test warehouse and returns it.
func CreateWarehouse(t *testing.T, db *gorm.DB) *warehouse.Warehouse {
	t.Helper()
	w := &warehouse.Warehouse{
		ID:       uuid.New(),
		Name:     "Test Warehouse " + uuid.New().String()[:8],
		IsActive: true,
	}
	if err := db.Create(w).Error; err != nil {
		t.Fatalf("testutil: create warehouse: %v", err)
	}
	return w
}

// CreateProduct inserts a test product and returns it.
func CreateProduct(t *testing.T, db *gorm.DB) *products.Product {
	t.Helper()
	sale := 100.0
	purchase := 40.0
	p := &products.Product{
		ID:            uuid.New(),
		SKU:           "TEST-" + uuid.New().String()[:8],
		Name:          "Test Product",
		SalePrice:     &sale,
		PurchasePrice: &purchase,
		IsActive:      true,
	}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("testutil: create product: %v", err)
	}
	return p
}

// CreateInventory inserts an inventory row with the given quantity for (warehouse, product).
// Also inserts a purchase movement and matching FIFO batch.
func CreateInventory(t *testing.T, db *gorm.DB, warehouseID, productID, createdBy uuid.UUID, qty int) *inventory.Inventory {
	t.Helper()
	inv := &inventory.Inventory{
		ID:                uuid.New(),
		WarehouseID:       warehouseID,
		ProductID:         productID,
		Quantity:          qty,
		ReservedQuantity:  0,
		LowStockThreshold: 5,
	}
	if err := db.Create(inv).Error; err != nil {
		t.Fatalf("testutil: create inventory: %v", err)
	}

	reason := "test: initial stock"
	m := &inventory.Movement{
		ID:               uuid.New(),
		WarehouseID:      warehouseID,
		ProductID:        productID,
		MovementType:     inventory.MovementPurchase,
		Quantity:         qty,
		PreviousQuantity: 0,
		NewQuantity:      qty,
		CreatedBy:        createdBy,
		Reason:           &reason,
	}
	if err := db.Create(m).Error; err != nil {
		t.Fatalf("testutil: create inventory movement: %v", err)
	}
	if qty > 0 {
		b := &inventory.Batch{
			ID:                uuid.New(),
			WarehouseID:       warehouseID,
			ProductID:         productID,
			ReceivedQuantity:  qty,
			RemainingQuantity: qty,
			UnitCost:          40.0,
			ReceivedAt:        time.Now().UTC(),
			MovementID:        &m.ID,
			CreatedBy:         &createdBy,
		}
		if err := db.Create(b).Error; err != nil {
			t.Fatalf("testutil: create inventory batch: %v", err)
		}
	}
	return inv
}

// AuthHeader returns the Bearer token header value for use in test HTTP requests.
// Expects a raw access_token string (not the full TokenPairResponse).
func AuthHeader(token string) string {
	return "Bearer " + token
}
