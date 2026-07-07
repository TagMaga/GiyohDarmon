package inventory

import (
	"time"

	"github.com/google/uuid"
)

// ─── Inventory ────────────────────────────────────────────────────────────────

type InventoryResponse struct {
	ID                uuid.UUID `json:"id"`
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
	ProductID uuid.UUID `json:"product_id"   validate:"required"`
	// max=1000000 is a fat-finger/overflow guard, not a real stock limit.
	Quantity  int     `json:"quantity"      validate:"required,min=1,max=1000000"`
	UnitCost  float64 `json:"unit_cost"     validate:"min=0,max=10000000"`
	InvoiceNo *string `json:"invoice_no"`
	Notes     *string `json:"notes"`
}

type ReceivingResponse struct {
	MovementID uuid.UUID     `json:"movement_id"`
	Batch      BatchResponse `json:"batch"`
}

type UpdateReceivingRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity" validate:"required,min=1,max=1000000"`
	UnitCost  float64   `json:"unit_cost" validate:"min=0,max=10000000"`
	Notes     *string   `json:"notes"`
}

type ReceivingEditResponse struct {
	ID             uuid.UUID `json:"id"`
	MovementID     uuid.UUID `json:"movement_id"`
	EditedBy       uuid.UUID `json:"edited_by"`
	EditorName     string    `json:"editor_name"`
	OldProductID   uuid.UUID `json:"old_product_id"`
	NewProductID   uuid.UUID `json:"new_product_id"`
	OldProductName string    `json:"old_product_name"`
	NewProductName string    `json:"new_product_name"`
	OldQuantity    int       `json:"old_quantity"`
	NewQuantity    int       `json:"new_quantity"`
	OldUnitCost    float64   `json:"old_unit_cost"`
	NewUnitCost    float64   `json:"new_unit_cost"`
	OldNote        string    `json:"old_note"`
	NewNote        string    `json:"new_note"`
	EditedAt       time.Time `json:"edited_at"`
}

func ToReceivingEditResponse(row *ReceivingEditRow) ReceivingEditResponse {
	return ReceivingEditResponse{
		ID:             row.ID,
		MovementID:     row.MovementID,
		EditedBy:       row.EditedBy,
		EditorName:     row.EditorName,
		OldProductID:   row.OldProductID,
		NewProductID:   row.NewProductID,
		OldProductName: row.OldProductName,
		NewProductName: row.NewProductName,
		OldQuantity:    row.OldQuantity,
		NewQuantity:    row.NewQuantity,
		OldUnitCost:    row.OldUnitCost,
		NewUnitCost:    row.NewUnitCost,
		OldNote:        row.OldNote,
		NewNote:        row.NewNote,
		EditedAt:       row.EditedAt,
	}
}

// ─── Batch ────────────────────────────────────────────────────────────────────

type BatchResponse struct {
	ID                uuid.UUID `json:"id"`
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
		ProductID:         b.ProductID,
		ReceivedQuantity:  b.ReceivedQuantity,
		RemainingQuantity: b.RemainingQuantity,
		UnitCost:          b.UnitCost,
		ReceivedAt:        b.ReceivedAt,
		CreatedAt:         b.CreatedAt,
	}
}

type BatchListFilter struct {
	ProductID string `form:"product_id"`
}

// ─── Integrity ────────────────────────────────────────────────────────────────

type InventoryIntegrityDiscrepancy struct {
	InventoryID       uuid.UUID `json:"inventory_id"`
	ProductID         uuid.UUID `json:"product_id"`
	InventoryQuantity int       `json:"inventory_quantity"`
	BatchQuantity     int       `json:"batch_quantity"`
	Difference        int       `json:"difference"`
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

type CreateAdjustmentRequest struct {
	ProductID   uuid.UUID `json:"product_id"   validate:"required"`
	NewQuantity int       `json:"new_quantity"  validate:"min=0,max=1000000"`
	Reason      string    `json:"reason"        validate:"required,max=500"`
	// UnitCost is used when the adjustment increases stock (creates a batch).
	// Defaults to 0 when omitted.
	UnitCost *float64 `json:"unit_cost" validate:"omitempty,min=0,max=10000000"`
}

type AdjustmentResponse struct {
	ID               uuid.UUID `json:"id"`
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
	ProductID  uuid.UUID  `json:"product_id"   validate:"required"`
	Quantity   int        `json:"quantity"      validate:"required,min=1,max=1000000"`
	Reason     string     `json:"reason"        validate:"required,max=500"`
	ApprovedBy *uuid.UUID `json:"approved_by"`
}

type WriteoffResponse struct {
	ID         uuid.UUID  `json:"id"`
	ProductID  uuid.UUID  `json:"product_id"`
	Quantity   int        `json:"quantity"`
	Reason     string     `json:"reason"`
	ApprovedBy *uuid.UUID `json:"approved_by"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

func ToWriteoffResponse(w *Writeoff) WriteoffResponse {
	return WriteoffResponse{
		ID:         w.ID,
		ProductID:  w.ProductID,
		Quantity:   w.Quantity,
		Reason:     w.Reason,
		ApprovedBy: w.ApprovedBy,
		CreatedBy:  w.CreatedBy,
		CreatedAt:  w.CreatedAt,
	}
}

// ─── Movement ─────────────────────────────────────────────────────────────────

type MovementResponse struct {
	ID                uuid.UUID    `json:"id"`
	ProductID         uuid.UUID    `json:"product_id"`
	MovementType      MovementType `json:"movement_type"`
	Quantity          int          `json:"quantity"`
	PreviousQuantity  int          `json:"previous_quantity"`
	NewQuantity       int          `json:"new_quantity"`
	Reason            *string      `json:"reason"`
	ReferenceID       *uuid.UUID   `json:"reference_id"`
	CreatedBy         uuid.UUID    `json:"created_by"`
	CreatedByName     string       `json:"created_by_name"`
	CreatedAt         time.Time    `json:"created_at"`
	BatchID           *uuid.UUID   `json:"batch_id,omitempty"`
	BatchUnitCost     *float64     `json:"batch_unit_cost,omitempty"`
	BatchReceivedQty  *int         `json:"batch_received_quantity,omitempty"`
	BatchRemainingQty *int         `json:"batch_remaining_quantity,omitempty"`
	EditCount         int          `json:"edit_count"`
	OrderID           *uuid.UUID   `json:"order_id,omitempty"`
	OrderNumber       string       `json:"order_number,omitempty"`
	OrderStatus       string       `json:"order_status,omitempty"`
	CustomerName      string       `json:"customer_name,omitempty"`
	CustomerPhone     string       `json:"customer_phone,omitempty"`
	DeliveryAddress   string       `json:"delivery_address,omitempty"`
	CourierName       string       `json:"courier_name,omitempty"`
	SellerName        string       `json:"seller_name,omitempty"`
	TotalAmount       *float64     `json:"total_amount,omitempty"`
	DeliveryFee       *float64     `json:"delivery_fee,omitempty"`
	TotalOrderAmount  *float64     `json:"total_order_amount,omitempty"`
}

func ToMovementResponse(row *MovementRow) MovementResponse {
	return MovementResponse{
		ID:                row.ID,
		ProductID:         row.ProductID,
		MovementType:      row.MovementType,
		Quantity:          row.Quantity,
		PreviousQuantity:  row.PreviousQuantity,
		NewQuantity:       row.NewQuantity,
		Reason:            row.Reason,
		ReferenceID:       row.ReferenceID,
		CreatedBy:         row.CreatedBy,
		CreatedByName:     row.CreatedByName,
		CreatedAt:         row.CreatedAt,
		BatchID:           row.BatchID,
		BatchUnitCost:     row.BatchUnitCost,
		BatchReceivedQty:  row.BatchReceivedQty,
		BatchRemainingQty: row.BatchRemainingQty,
		EditCount:         row.EditCount,
		OrderID:           row.OrderID,
		OrderNumber:       row.OrderNumber,
		OrderStatus:       row.OrderStatus,
		CustomerName:      row.CustomerName,
		CustomerPhone:     row.CustomerPhone,
		DeliveryAddress:   row.DeliveryAddress,
		CourierName:       row.CourierName,
		SellerName:        row.SellerName,
		TotalAmount:       row.TotalAmount,
		DeliveryFee:       row.DeliveryFee,
		TotalOrderAmount:  row.TotalOrderAmount,
	}
}

// ─── Filters ──────────────────────────────────────────────────────────────────

type ListInventoryFilter struct{}

type ListMovementsFilter struct {
	ProductID    string `form:"product_id"`
	MovementType string `form:"movement_type"`
	// DateFrom / DateTo accept YYYY-MM-DD and filter on created_at (inclusive).
	DateFrom string `form:"date_from"`
	DateTo   string `form:"date_to"`
}
