package seed

// courier_demo.go — Demo courier + courier-warehouse ledger (dev/staging only).
//
// Seeds one named courier account with a populated courier_inventory ledger
// so the courier-warehouse audit flow (received vs. delivered vs. pending
// return) has real rows to query instead of an empty demo account. Follows
// the same check-before-insert / idempotent pattern as the rest of this
// package.

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/warehouses"
	"gorm.io/gorm"
)

const (
	CourierDemoPhone    = "+992900000008"
	CourierDemoFullName = "Sodikyor Nazarshoev"
)

// courierDemoProduct describes one product this demo courier was issued,
// and how much of it they've delivered so far. Quantity to return is
// derived as Received - Delivered.
type courierDemoProduct struct {
	sku           string
	name          string
	salePrice     float64
	purchasePrice float64
	received      int
	delivered     int
}

var courierDemoProducts = []courierDemoProduct{
	{sku: "DEMO-COURIER-001", name: "Cotton T-Shirt (Demo)", salePrice: 120, purchasePrice: 55, received: 50, delivered: 42},
	{sku: "DEMO-COURIER-002", name: "Kitchen Towel Set (Demo)", salePrice: 80, purchasePrice: 30, received: 30, delivered: 25},
}

// seedCourierDemo creates the demo courier user, their courier warehouse,
// and a populated inventory ledger (transfer -> courier stock -> partial
// delivery -> pending return) for each courierDemoProduct.
func seedCourierDemo(ctx context.Context, db *gorm.DB, res *Result, supplierID, issuedBy uuid.UUID) error {
	courierID, err := seedUser(ctx, db, demoUser{
		phone:    CourierDemoPhone,
		fullName: CourierDemoFullName,
		role:     "courier",
	}, "password123")
	if err != nil {
		return fmt.Errorf("seed courier user: %w", err)
	}
	if courierID == uuid.Nil {
		res.skipped("user " + CourierDemoPhone)
		existing, err := getUserByPhone(ctx, db, CourierDemoPhone)
		if err != nil || existing == nil {
			return fmt.Errorf("lookup existing demo courier: %w", err)
		}
		courierID = existing.ID
	} else {
		res.created("user " + CourierDemoPhone + " (courier, " + CourierDemoFullName + ")")
	}

	warehouseID, err := getOrCreateCourierWarehouse(ctx, db, res, courierID)
	if err != nil {
		return fmt.Errorf("seed courier warehouse: %w", err)
	}

	for _, dp := range courierDemoProducts {
		if err := seedCourierDemoProduct(ctx, db, res, dp, supplierID, warehouseID, courierID, issuedBy); err != nil {
			return fmt.Errorf("seed courier demo product %s: %w", dp.sku, err)
		}
	}

	return nil
}

func getOrCreateCourierWarehouse(ctx context.Context, db *gorm.DB, res *Result, courierID uuid.UUID) (uuid.UUID, error) {
	var existing warehouses.Warehouse
	err := db.WithContext(ctx).Where("courier_id = ?", courierID).First(&existing).Error
	if err == nil {
		res.skipped("courier warehouse for " + CourierDemoFullName)
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	w := warehouses.Warehouse{
		ID:        uuid.New(),
		Type:      warehouses.WarehouseTypeCourier,
		Name:      "Warehouse — " + CourierDemoFullName,
		CourierID: &courierID,
		IsActive:  true,
	}
	if err := db.WithContext(ctx).Create(&w).Error; err != nil {
		return uuid.Nil, err
	}
	res.created("courier warehouse for " + CourierDemoFullName)
	return w.ID, nil
}

func seedCourierDemoProduct(ctx context.Context, db *gorm.DB, res *Result, dp courierDemoProduct, supplierID, warehouseID, courierID, issuedBy uuid.UUID) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingInv warehouses.CourierInventory
		err := tx.Where("warehouse_id = ? AND product_id IN (SELECT id FROM products WHERE sku = ?)", warehouseID, dp.sku).
			First(&existingInv).Error
		if err == nil {
			res.skipped(fmt.Sprintf("courier_inventory %s for %s", dp.sku, CourierDemoFullName))
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		productID, err := getOrCreateSeedProduct(ctx, tx, res, dp, supplierID)
		if err != nil {
			return err
		}

		toReturn := dp.received - dp.delivered
		if toReturn < 0 {
			return fmt.Errorf("delivered (%d) exceeds received (%d) for %s", dp.delivered, dp.received, dp.sku)
		}

		transfer := warehouses.InventoryTransfer{
			ID:              uuid.New(),
			FromWarehouseID: warehouses.DefaultMainWarehouseID,
			ToCourierID:     courierID,
			ToWarehouseID:   &warehouseID,
			Status:          warehouses.TransferAccepted,
			CreatedBy:       issuedBy,
			DecidedBy:       &issuedBy,
		}
		if err := tx.Create(&transfer).Error; err != nil {
			return fmt.Errorf("create transfer: %w", err)
		}
		item := warehouses.InventoryTransferItem{
			ID:         uuid.New(),
			TransferID: transfer.ID,
			ProductID:  productID,
			Quantity:   dp.received,
		}
		if err := tx.Create(&item).Error; err != nil {
			return fmt.Errorf("create transfer item: %w", err)
		}

		transferInReason := "seed: demo courier transfer"
		transferIn := warehouses.CourierInventoryMovement{
			ID:               uuid.New(),
			WarehouseID:      warehouseID,
			ProductID:        productID,
			MovementType:     warehouses.CourierMovementTransferIn,
			Quantity:         dp.received,
			PreviousQuantity: 0,
			NewQuantity:      dp.received,
			ReferenceType:    strPtr(warehouses.RefTypeTransfer),
			ReferenceID:      &transfer.ID,
			Reason:           &transferInReason,
			CreatedBy:        issuedBy,
		}
		if err := tx.Create(&transferIn).Error; err != nil {
			return fmt.Errorf("create transfer_in movement: %w", err)
		}

		if dp.delivered > 0 {
			deliveredReason := "seed: demo courier delivery"
			delivered := warehouses.CourierInventoryMovement{
				ID:               uuid.New(),
				WarehouseID:      warehouseID,
				ProductID:        productID,
				MovementType:     warehouses.CourierMovementDelivered,
				Quantity:         dp.delivered,
				PreviousQuantity: dp.received,
				NewQuantity:      toReturn,
				Reason:           &deliveredReason,
				CreatedBy:        issuedBy,
			}
			if err := tx.Create(&delivered).Error; err != nil {
				return fmt.Errorf("create delivered movement: %w", err)
			}
		}

		inv := warehouses.CourierInventory{
			ID:          uuid.New(),
			WarehouseID: warehouseID,
			ProductID:   productID,
			Quantity:    toReturn,
		}
		if err := tx.Create(&inv).Error; err != nil {
			return fmt.Errorf("create courier_inventory: %w", err)
		}

		if toReturn > 0 {
			ret := warehouses.CourierReturn{
				ID:              uuid.New(),
				CourierID:       courierID,
				FromWarehouseID: warehouseID,
				ToWarehouseID:   warehouses.DefaultMainWarehouseID,
				Status:          warehouses.ReturnRequested,
				CreatedBy:       courierID,
			}
			if err := tx.Create(&ret).Error; err != nil {
				return fmt.Errorf("create courier_return: %w", err)
			}
			retItem := warehouses.CourierReturnItem{
				ID:        uuid.New(),
				ReturnID:  ret.ID,
				ProductID: productID,
				Quantity:  toReturn,
			}
			if err := tx.Create(&retItem).Error; err != nil {
				return fmt.Errorf("create courier_return_item: %w", err)
			}
		}

		res.created(fmt.Sprintf("courier ledger %s: received=%d delivered=%d to_return=%d", dp.sku, dp.received, dp.delivered, toReturn))
		return nil
	})
}

func getOrCreateSeedProduct(ctx context.Context, tx *gorm.DB, res *Result, dp courierDemoProduct, supplierID uuid.UUID) (uuid.UUID, error) {
	var existing products.Product
	err := tx.WithContext(ctx).Where("sku = ? AND deleted_at IS NULL", dp.sku).First(&existing).Error
	if err == nil {
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	sale := dp.salePrice
	purchase := dp.purchasePrice
	p := products.Product{
		ID:            uuid.New(),
		SKU:           dp.sku,
		Name:          dp.name,
		SalePrice:     &sale,
		PurchasePrice: &purchase,
		SupplierID:    &supplierID,
		IsActive:      true,
	}
	if err := tx.WithContext(ctx).Create(&p).Error; err != nil {
		return uuid.Nil, fmt.Errorf("create product %s: %w", dp.sku, err)
	}
	res.created("product " + dp.sku)
	return p.ID, nil
}

func strPtr(s string) *string { return &s }
