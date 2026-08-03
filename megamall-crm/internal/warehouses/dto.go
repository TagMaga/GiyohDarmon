package warehouses

import (
	"time"

	"github.com/google/uuid"
)

// ─── Warehouses ───────────────────────────────────────────────────────────────

type WarehouseResponse struct {
	ID        uuid.UUID     `json:"id"`
	Type      WarehouseType `json:"type"`
	Name      string        `json:"name"`
	CityID    *uuid.UUID    `json:"city_id,omitempty"`
	CourierID *uuid.UUID    `json:"courier_id,omitempty"`
	IsActive  bool          `json:"is_active"`
	CreatedAt time.Time     `json:"created_at"`
}

func ToWarehouseResponse(w *Warehouse) WarehouseResponse {
	return WarehouseResponse{
		ID: w.ID, Type: w.Type, Name: w.Name, CityID: w.CityID,
		CourierID: w.CourierID, IsActive: w.IsActive, CreatedAt: w.CreatedAt,
	}
}

type CreateWarehouseRequest struct {
	Name   string     `json:"name" validate:"required,max=150"`
	CityID *uuid.UUID `json:"city_id"`
}

type UpdateWarehouseNameRequest struct {
	Name string `json:"name" validate:"required,max=150"`
}

// ─── Inventory distribution ──────────────────────────────────────────────────

// InventoryLocationResponse is a selectable stock location on the inventory
// page. The legacy main inventory pool is represented by the seeded default
// main warehouse; courier locations come from courier_inventory.
type InventoryLocationResponse struct {
	ID        uuid.UUID     `json:"id"`
	Type      WarehouseType `json:"type"`
	Name      string        `json:"name"`
	CourierID *uuid.UUID    `json:"courier_id,omitempty"`
}

// InventoryDistributionItemResponse is one product's balance at one location.
// Keeping the response normalized avoids repeating warehouse names for every
// product and lets the frontend aggregate any selected location combination.
type InventoryDistributionItemResponse struct {
	ProductID         uuid.UUID `json:"product_id"`
	WarehouseID       uuid.UUID `json:"warehouse_id"`
	Quantity          int       `json:"quantity"`
	ReservedQuantity  int       `json:"reserved_quantity"`
	BlockedQuantity   int       `json:"blocked_quantity"`
	AvailableQuantity int       `json:"available_quantity"`
}

type InventoryDistributionResponse struct {
	Locations []InventoryLocationResponse         `json:"locations"`
	Items     []InventoryDistributionItemResponse `json:"items"`
}

// ─── Transfers ────────────────────────────────────────────────────────────────

type TransferItemRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity" validate:"required,min=1,max=1000000"`
}

type CreateTransferRequest struct {
	FromWarehouseID uuid.UUID             `json:"from_warehouse_id" validate:"required"`
	CourierID       uuid.UUID             `json:"courier_id" validate:"required"`
	Items           []TransferItemRequest `json:"items" validate:"required,min=1,dive"`
}

type TransferItemResponse struct {
	ProductID       uuid.UUID `json:"product_id"`
	ProductName     string    `json:"product_name"`
	ProductImageURL *string   `json:"product_image_url,omitempty"`
	Quantity        int       `json:"quantity"`
}

type TransferResponse struct {
	ID                uuid.UUID              `json:"id"`
	FromWarehouseID   uuid.UUID              `json:"from_warehouse_id"`
	FromWarehouseName string                 `json:"from_warehouse_name,omitempty"`
	ToCourierID       uuid.UUID              `json:"to_courier_id"`
	CourierName       string                 `json:"courier_name,omitempty"`
	ToWarehouseID     *uuid.UUID             `json:"to_warehouse_id,omitempty"`
	Status            TransferStatus         `json:"status"`
	CreatedBy         uuid.UUID              `json:"created_by"`
	CreatedByName     string                 `json:"created_by_name,omitempty"`
	CreatedAt         time.Time              `json:"created_at"`
	DecidedBy         *uuid.UUID             `json:"decided_by,omitempty"`
	DecidedAt         *time.Time             `json:"decided_at,omitempty"`
	Items             []TransferItemResponse `json:"items"`
}

type ListTransfersFilter struct {
	Status string `form:"status"`
}

// ─── Courier warehouse (My Warehouse) ────────────────────────────────────────

// CourierStockItem is deliberately cost-free — couriers must never see
// purchase price or the monetary value of their inventory.
type CourierStockItem struct {
	ProductID         uuid.UUID `json:"product_id"`
	ProductName       string    `json:"product_name"`
	ProductImageURL   *string   `json:"product_image_url,omitempty"`
	Quantity          int       `json:"quantity"`
	ReservedQuantity  int       `json:"reserved_quantity"`
	AvailableQuantity int       `json:"available_quantity"`
}

type MyWarehouseResponse struct {
	WarehouseID      *uuid.UUID         `json:"warehouse_id,omitempty"`
	Items            []CourierStockItem `json:"items"`
	PendingTransfers []TransferResponse `json:"pending_transfers"`
}

// ─── Returns ──────────────────────────────────────────────────────────────────

type CreateReturnRequest struct {
	ToWarehouseID uuid.UUID `json:"to_warehouse_id" validate:"required"`
}

type ReturnItemResponse struct {
	ProductID       uuid.UUID `json:"product_id"`
	ProductName     string    `json:"product_name"`
	ProductImageURL *string   `json:"product_image_url,omitempty"`
	Quantity        int       `json:"quantity"`
}

type ReturnResponse struct {
	ID              uuid.UUID            `json:"id"`
	CourierID       uuid.UUID            `json:"courier_id"`
	CourierName     string               `json:"courier_name,omitempty"`
	FromWarehouseID uuid.UUID            `json:"from_warehouse_id"`
	ToWarehouseID   uuid.UUID            `json:"to_warehouse_id"`
	Status          ReturnStatus         `json:"status"`
	CreatedAt       time.Time            `json:"created_at"`
	DecidedBy       *uuid.UUID           `json:"decided_by,omitempty"`
	DecidedAt       *time.Time           `json:"decided_at,omitempty"`
	Items           []ReturnItemResponse `json:"items"`
}

// ─── Lost product reports ────────────────────────────────────────────────────

type CreateLostReportRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity" validate:"required,min=1,max=1000000"`
	PhotoURL  string    `json:"photo_url" validate:"required"`
	Comment   string    `json:"comment" validate:"required,max=1000"`
}

type DecideLostReportRequest struct {
	Approve         bool    `json:"approve"`
	RejectionReason *string `json:"rejection_reason"`
}

type LostReportResponse struct {
	ID          uuid.UUID        `json:"id"`
	CourierID   uuid.UUID        `json:"courier_id"`
	CourierName string           `json:"courier_name,omitempty"`
	ProductID   uuid.UUID        `json:"product_id"`
	ProductName string           `json:"product_name,omitempty"`
	Quantity    int              `json:"quantity"`
	PhotoURL    string           `json:"photo_url"`
	Comment     string           `json:"comment"`
	UnitCost    float64          `json:"unit_cost,omitempty"`
	DebtAmount  float64          `json:"debt_amount,omitempty"`
	Status      LostReportStatus `json:"status"`
	CreatedAt   time.Time        `json:"created_at"`
	DecidedAt   *time.Time       `json:"decided_at,omitempty"`
}

func ToLostReportResponse(r *LostProductReport, includeCost bool) LostReportResponse {
	out := LostReportResponse{
		ID: r.ID, CourierID: r.CourierID, ProductID: r.ProductID,
		Quantity: r.Quantity, PhotoURL: r.PhotoURL, Comment: r.Comment,
		Status: r.Status, CreatedAt: r.CreatedAt, DecidedAt: r.DecidedAt,
	}
	if includeCost {
		out.UnitCost = r.UnitCost
		out.DebtAmount = r.DebtAmount
	}
	return out
}
