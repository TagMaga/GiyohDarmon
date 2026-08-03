// Package warehouses implements courier-warehouse inventory tracking: main
// warehouses, one personal warehouse per courier, stock issuance (transfer)
// from a main warehouse to a courier, full-inventory returns, and lost-product
// debt reporting.
//
// The legacy internal/inventory table keeps representing the main warehouse
// pool exactly as it always has (product-scoped, no location dimension) —
// see migration 00091 for why. This package adds a second, warehouse-scoped
// ledger (courier_inventory / courier_inventory_movements) used only for
// stock physically held by a courier, and the transfer/return/lost-report
// workflows that move stock between the two ledgers.
package warehouses

import (
	"time"

	"github.com/google/uuid"
)

type WarehouseType string

const (
	WarehouseTypeMain    WarehouseType = "main"
	WarehouseTypeCourier WarehouseType = "courier"
)

// DefaultMainWarehouseID is the single main warehouse seeded by migration
// 00091. Every pre-existing order reservation and every transfer whose
// source isn't explicitly chosen resolves here.
var DefaultMainWarehouseID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

type Warehouse struct {
	ID        uuid.UUID     `gorm:"type:uuid;primaryKey"`
	Type      WarehouseType `gorm:"type:warehouse_type;not null"`
	Name      string        `gorm:"not null"`
	CityID    *uuid.UUID    `gorm:"type:uuid;column:city_id"`
	CourierID *uuid.UUID    `gorm:"type:uuid;column:courier_id"`
	IsActive  bool          `gorm:"column:is_active;not null;default:true"`
	CreatedAt time.Time     `gorm:"autoCreateTime"`
	UpdatedAt time.Time     `gorm:"autoUpdateTime"`
}

func (Warehouse) TableName() string { return "warehouses" }

// CourierInventory tracks stock physically held by a courier (or, in
// principle, any non-legacy warehouse). One row per (warehouse, product).
type CourierInventory struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey"`
	WarehouseID       uuid.UUID `gorm:"type:uuid;not null;column:warehouse_id"`
	ProductID         uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	Quantity          int       `gorm:"not null;default:0"`
	ReservedQuantity  int       `gorm:"not null;default:0;column:reserved_quantity"`
	BlockedQuantity   int       `gorm:"not null;default:0;column:blocked_quantity"`
	AvailableQuantity int       `gorm:"->;<-:false;column:available_quantity"`
	CreatedAt         time.Time `gorm:"autoCreateTime"`
	UpdatedAt         time.Time `gorm:"autoUpdateTime"`
}

func (CourierInventory) TableName() string { return "courier_inventory" }

type CourierMovementType string

const (
	CourierMovementTransferIn     CourierMovementType = "transfer_in"
	CourierMovementTransferOut    CourierMovementType = "transfer_out"
	CourierMovementDelivered      CourierMovementType = "delivered"
	CourierMovementRefused        CourierMovementType = "refused"
	CourierMovementPostponed      CourierMovementType = "postponed"
	CourierMovementCancelled      CourierMovementType = "cancelled"
	CourierMovementReturned       CourierMovementType = "returned"
	CourierMovementAddressChanged CourierMovementType = "address_changed"
	CourierMovementClaimReserve   CourierMovementType = "claim_reserve"
	CourierMovementClaimRelease   CourierMovementType = "claim_release"
	CourierMovementLost           CourierMovementType = "lost"
)

// ReferenceType values for CourierInventoryMovement.ReferenceType.
const (
	RefTypeTransfer   = "transfer"
	RefTypeOrder      = "order"
	RefTypeReturn     = "return"
	RefTypeLostReport = "lost_report"
)

type CourierInventoryMovement struct {
	ID               uuid.UUID           `gorm:"type:uuid;primaryKey"`
	WarehouseID      uuid.UUID           `gorm:"type:uuid;not null;column:warehouse_id"`
	ProductID        uuid.UUID           `gorm:"type:uuid;not null;column:product_id"`
	MovementType     CourierMovementType `gorm:"type:courier_movement_type;not null;column:movement_type"`
	Quantity         int                 `gorm:"not null"`
	PreviousQuantity int                 `gorm:"not null;column:previous_quantity"`
	NewQuantity      int                 `gorm:"not null;column:new_quantity"`
	ReferenceType    *string             `gorm:"column:reference_type"`
	ReferenceID      *uuid.UUID          `gorm:"type:uuid;column:reference_id"`
	Reason           *string             `gorm:"column:reason"`
	CreatedBy        uuid.UUID           `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt        time.Time           `gorm:"autoCreateTime"`
}

func (CourierInventoryMovement) TableName() string { return "courier_inventory_movements" }

// CourierInventoryBatch is a cost lot held by a courier warehouse — the
// courier-side equivalent of inventory.Batch. One row per batch consumed on
// the courier's behalf when a transfer is accepted, preserving the exact
// per-накладная unit cost and FIFO order it was consumed from the main
// warehouse (see AcceptTransfer). Consumed FIFO (oldest created_at first) at
// order-delivery time — see Service.ConsumeCourierFIFO.
type CourierInventoryBatch struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey"`
	WarehouseID       uuid.UUID  `gorm:"type:uuid;not null;column:warehouse_id"`
	ProductID         uuid.UUID  `gorm:"type:uuid;not null;column:product_id"`
	SourceBatchID     *uuid.UUID `gorm:"type:uuid;column:source_batch_id"`
	TransferID        *uuid.UUID `gorm:"type:uuid;column:transfer_id"`
	ReceivedQuantity  int        `gorm:"not null;column:received_quantity"`
	RemainingQuantity int        `gorm:"not null;column:remaining_quantity"`
	UnitCost          float64    `gorm:"type:numeric(12,2);not null;column:unit_cost"`
	CreatedAt         time.Time  `gorm:"autoCreateTime"`
}

func (CourierInventoryBatch) TableName() string { return "courier_inventory_batches" }

// CourierBatchConsumption records how many units, at what unit cost, were
// consumed from a specific CourierInventoryBatch by a specific
// CourierInventoryMovement (always a "delivered" movement in practice).
// Mirrors inventory.BatchConsumption.
type CourierBatchConsumption struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	BatchID    uuid.UUID `gorm:"type:uuid;not null;column:batch_id"`
	MovementID uuid.UUID `gorm:"type:uuid;not null;column:movement_id"`
	Quantity   int       `gorm:"not null"`
	UnitCost   float64   `gorm:"type:numeric(12,2);not null;column:unit_cost"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

func (CourierBatchConsumption) TableName() string { return "courier_batch_consumptions" }

type TransferStatus string

const (
	TransferIssued   TransferStatus = "issued"
	TransferAccepted TransferStatus = "accepted"
	TransferRejected TransferStatus = "rejected"
)

type InventoryTransfer struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey"`
	FromWarehouseID uuid.UUID      `gorm:"type:uuid;not null;column:from_warehouse_id"`
	ToCourierID     uuid.UUID      `gorm:"type:uuid;not null;column:to_courier_id"`
	ToWarehouseID   *uuid.UUID     `gorm:"type:uuid;column:to_warehouse_id"`
	Status          TransferStatus `gorm:"type:transfer_status;not null;default:issued"`
	CreatedBy       uuid.UUID      `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt       time.Time      `gorm:"autoCreateTime"`
	DecidedBy       *uuid.UUID     `gorm:"type:uuid;column:decided_by"`
	DecidedAt       *time.Time     `gorm:"column:decided_at"`

	Items []InventoryTransferItem `gorm:"foreignKey:TransferID;references:ID"`
}

func (InventoryTransfer) TableName() string { return "inventory_transfers" }

type InventoryTransferItem struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	TransferID uuid.UUID `gorm:"type:uuid;not null;column:transfer_id"`
	ProductID  uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	Quantity   int       `gorm:"not null"`
}

func (InventoryTransferItem) TableName() string { return "inventory_transfer_items" }

type ReturnStatus string

const (
	ReturnRequested ReturnStatus = "requested"
	ReturnAccepted  ReturnStatus = "accepted"
	ReturnRejected  ReturnStatus = "rejected"
)

type CourierReturn struct {
	ID              uuid.UUID    `gorm:"type:uuid;primaryKey"`
	CourierID       uuid.UUID    `gorm:"type:uuid;not null;column:courier_id"`
	FromWarehouseID uuid.UUID    `gorm:"type:uuid;not null;column:from_warehouse_id"`
	ToWarehouseID   uuid.UUID    `gorm:"type:uuid;not null;column:to_warehouse_id"`
	Status          ReturnStatus `gorm:"type:return_status;not null;default:requested"`
	CreatedBy       uuid.UUID    `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt       time.Time    `gorm:"autoCreateTime"`
	DecidedBy       *uuid.UUID   `gorm:"type:uuid;column:decided_by"`
	DecidedAt       *time.Time   `gorm:"column:decided_at"`

	Items []CourierReturnItem `gorm:"foreignKey:ReturnID;references:ID"`
}

func (CourierReturn) TableName() string { return "courier_returns" }

type CourierReturnItem struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	ReturnID  uuid.UUID `gorm:"type:uuid;not null;column:return_id"`
	ProductID uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	Quantity  int       `gorm:"not null"`
}

func (CourierReturnItem) TableName() string { return "courier_return_items" }

type LostReportStatus string

const (
	LostReportPending  LostReportStatus = "pending"
	LostReportApproved LostReportStatus = "approved"
	LostReportRejected LostReportStatus = "rejected"
)

// LostProductReport records a courier-reported lost product. Approval
// deducts the stock from the courier's warehouse and creates a debt (cost
// only, no delivery fee) against the courier.
type LostProductReport struct {
	ID          uuid.UUID        `gorm:"type:uuid;primaryKey"`
	CourierID   uuid.UUID        `gorm:"type:uuid;not null;column:courier_id"`
	WarehouseID uuid.UUID        `gorm:"type:uuid;not null;column:warehouse_id"`
	ProductID   uuid.UUID        `gorm:"type:uuid;not null;column:product_id"`
	Quantity    int              `gorm:"not null"`
	PhotoURL    string           `gorm:"not null;column:photo_url"`
	Comment     string           `gorm:"not null"`
	UnitCost    float64          `gorm:"type:numeric(12,2);not null;column:unit_cost"`
	DebtAmount  float64          `gorm:"type:numeric(12,2);not null;column:debt_amount"`
	Status      LostReportStatus `gorm:"type:lost_report_status;not null;default:pending"`
	CreatedBy   uuid.UUID        `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt   time.Time        `gorm:"autoCreateTime"`
	DecidedBy   *uuid.UUID       `gorm:"type:uuid;column:decided_by"`
	DecidedAt   *time.Time       `gorm:"column:decided_at"`
}

func (LostProductReport) TableName() string { return "lost_product_reports" }
