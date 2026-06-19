package inventory

import (
	"time"

	"github.com/google/uuid"
)

// ─── Inventory ────────────────────────────────────────────────────────────────

type InventoryResponse struct {
	ID                uuid.UUID `json:"id"`
	WarehouseID       uuid.UUID `json:"warehouse_id"`
	ProductID         uuid.UUID `json:"product_id"`
	Quantity          int       `json:"quantity"`
	ReservedQuantity  int       `json:"reserved_quantity"`
	AvailableQuantity int       `json:"available_quantity"`
	LowStockThreshold int       `json:"low_stock_threshold"`
	IsLowStock        bool      `json:"is_low_stock"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func ToInventoryResponse(inv *Inventory) InventoryResponse {
	return InventoryResponse{
		ID:                inv.ID,
		WarehouseID:       inv.WarehouseID,
		ProductID:         inv.ProductID,
		Quantity:          inv.Quantity,
		ReservedQuantity:  inv.ReservedQuantity,
		AvailableQuantity: inv.AvailableQuantity,
		LowStockThreshold: inv.LowStockThreshold,
		IsLowStock:        inv.AvailableQuantity <= inv.LowStockThreshold,
		UpdatedAt:         inv.UpdatedAt,
	}
}

// ─── Receiving (FIFO batch receipt) ──────────────────────────────────────────

type CreateReceivingRequest struct {
	WarehouseID uuid.UUID `json:"warehouse_id" validate:"required"`
	ProductID   uuid.UUID `json:"product_id"   validate:"required"`
	Quantity    int       `json:"quantity"      validate:"required,min=1"`
	UnitCost    float64   `json:"unit_cost"     validate:"min=0"`
	InvoiceNo   *string   `json:"invoice_no"`
	Notes       *string   `json:"notes"`
}

type ReceivingResponse struct {
	MovementID uuid.UUID     `json:"movement_id"`
	Batch      BatchResponse `json:"batch"`
}

// ─── Batch ────────────────────────────────────────────────────────────────────

type BatchResponse struct {
	ID                uuid.UUID `json:"id"`
	WarehouseID       uuid.UUID `json:"warehouse_id"`
	ProductID         uuid.UUID `json:"product_id"`
	ReceivedQuantity  int       `json:"received_quantity"`
	RemainingQuantity int       `json:"remaining_quantity"`
	UnitCost          float64   `json:"unit_cost"`
	ReceivedAt        time.Time `json:"received_at"`
	CreatedAt         time.Time `json:"created_at"`
}

func ToBatchResponse(b *Batch) BatchResponse {
	return BatchResponse{
		ID:                b.ID,
		WarehouseID:       b.WarehouseID,
		ProductID:         b.ProductID,
		ReceivedQuantity:  b.ReceivedQuantity,
		RemainingQuantity: b.RemainingQuantity,
		UnitCost:          b.UnitCost,
		ReceivedAt:        b.ReceivedAt,
		CreatedAt:         b.CreatedAt,
	}
}

type BatchListFilter struct {
	WarehouseID string `form:"warehouse_id"`
	ProductID   string `form:"product_id"`
}

// ─── Integrity ────────────────────────────────────────────────────────────────

type InventoryIntegrityDiscrepancy struct {
	InventoryID       uuid.UUID `json:"inventory_id"`
	WarehouseID       uuid.UUID `json:"warehouse_id"`
	ProductID         uuid.UUID `json:"product_id"`
	InventoryQuantity int       `json:"inventory_quantity"`
	BatchQuantity     int       `json:"batch_quantity"`
	Difference        int       `json:"difference"`
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

type CreateAdjustmentRequest struct {
	WarehouseID uuid.UUID `json:"warehouse_id" validate:"required"`
	ProductID   uuid.UUID `json:"product_id"   validate:"required"`
	NewQuantity int       `json:"new_quantity"  validate:"min=0"`
	Reason      string    `json:"reason"        validate:"required,max=500"`
	// UnitCost is used when the adjustment increases stock (creates a batch).
	// Defaults to 0 when omitted.
	UnitCost *float64 `json:"unit_cost"`
}

type AdjustmentResponse struct {
	ID               uuid.UUID `json:"id"`
	WarehouseID      uuid.UUID `json:"warehouse_id"`
	ProductID        uuid.UUID `json:"product_id"`
	PreviousQuantity int       `json:"previous_quantity"`
	NewQuantity      int       `json:"new_quantity"`
	Reason           string    `json:"reason"`
	CreatedBy        uuid.UUID `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

func ToAdjustmentResponse(a *Adjustment) AdjustmentResponse {
	return AdjustmentResponse{
		ID:               a.ID,
		WarehouseID:      a.WarehouseID,
		ProductID:        a.ProductID,
		PreviousQuantity: a.PreviousQuantity,
		NewQuantity:      a.NewQuantity,
		Reason:           a.Reason,
		CreatedBy:        a.CreatedBy,
		CreatedAt:        a.CreatedAt,
	}
}

// ─── Writeoff ─────────────────────────────────────────────────────────────────

type CreateWriteoffRequest struct {
	WarehouseID uuid.UUID  `json:"warehouse_id" validate:"required"`
	ProductID   uuid.UUID  `json:"product_id"   validate:"required"`
	Quantity    int        `json:"quantity"      validate:"required,min=1"`
	Reason      string     `json:"reason"        validate:"required,max=500"`
	ApprovedBy  *uuid.UUID `json:"approved_by"`
}

type WriteoffResponse struct {
	ID          uuid.UUID  `json:"id"`
	WarehouseID uuid.UUID  `json:"warehouse_id"`
	ProductID   uuid.UUID  `json:"product_id"`
	Quantity    int        `json:"quantity"`
	Reason      string     `json:"reason"`
	ApprovedBy  *uuid.UUID `json:"approved_by"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
}

func ToWriteoffResponse(w *Writeoff) WriteoffResponse {
	return WriteoffResponse{
		ID:          w.ID,
		WarehouseID: w.WarehouseID,
		ProductID:   w.ProductID,
		Quantity:    w.Quantity,
		Reason:      w.Reason,
		ApprovedBy:  w.ApprovedBy,
		CreatedBy:   w.CreatedBy,
		CreatedAt:   w.CreatedAt,
	}
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

type CreateTransferRequest struct {
	FromWarehouseID uuid.UUID `json:"from_warehouse_id" validate:"required"`
	ToWarehouseID   uuid.UUID `json:"to_warehouse_id"   validate:"required"`
	ProductID       uuid.UUID `json:"product_id"        validate:"required"`
	Quantity        int       `json:"quantity"           validate:"required,min=1"`
	Reason          *string   `json:"reason"`
}

type TransferResponse struct {
	TransferOutMovementID uuid.UUID `json:"transfer_out_movement_id"`
	TransferInMovementID  uuid.UUID `json:"transfer_in_movement_id"`
	FromWarehouseID       uuid.UUID `json:"from_warehouse_id"`
	ToWarehouseID         uuid.UUID `json:"to_warehouse_id"`
	ProductID             uuid.UUID `json:"product_id"`
	Quantity              int       `json:"quantity"`
}

// ─── Movement ─────────────────────────────────────────────────────────────────

type MovementResponse struct {
	ID               uuid.UUID    `json:"id"`
	WarehouseID      uuid.UUID    `json:"warehouse_id"`
	ProductID        uuid.UUID    `json:"product_id"`
	MovementType     MovementType `json:"movement_type"`
	Quantity         int          `json:"quantity"`
	PreviousQuantity int          `json:"previous_quantity"`
	NewQuantity      int          `json:"new_quantity"`
	Reason           *string      `json:"reason"`
	ReferenceID      *uuid.UUID   `json:"reference_id"`
	CreatedBy        uuid.UUID    `json:"created_by"`
	CreatedByName    string       `json:"created_by_name"`
	CreatedAt        time.Time    `json:"created_at"`
}

func ToMovementResponse(row *MovementRow) MovementResponse {
	return MovementResponse{
		ID:               row.ID,
		WarehouseID:      row.WarehouseID,
		ProductID:        row.ProductID,
		MovementType:     row.MovementType,
		Quantity:         row.Quantity,
		PreviousQuantity: row.PreviousQuantity,
		NewQuantity:      row.NewQuantity,
		Reason:           row.Reason,
		ReferenceID:      row.ReferenceID,
		CreatedBy:        row.CreatedBy,
		CreatedByName:    row.CreatedByName,
		CreatedAt:        row.CreatedAt,
	}
}

// ─── Filters ──────────────────────────────────────────────────────────────────

type ListInventoryFilter struct {
	WarehouseID string `form:"warehouse_id"`
}

type ListMovementsFilter struct {
	WarehouseID  string `form:"warehouse_id"`
	ProductID    string `form:"product_id"`
	MovementType string `form:"movement_type"`
	// DateFrom / DateTo accept YYYY-MM-DD and filter on created_at (inclusive).
	DateFrom string `form:"date_from"`
	DateTo   string `form:"date_to"`
}
