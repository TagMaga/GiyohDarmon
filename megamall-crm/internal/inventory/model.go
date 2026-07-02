package inventory

import (
	"time"

	"github.com/google/uuid"
)

// MovementType represents the direction and reason for a stock change.
type MovementType string

const (
	MovementPurchase    MovementType = "purchase"
	MovementSale        MovementType = "sale"
	MovementReturn      MovementType = "return"
	MovementTransferIn  MovementType = "transfer_in"
	MovementTransferOut MovementType = "transfer_out"
	MovementAdjustment  MovementType = "adjustment"
	MovementWriteoff    MovementType = "writeoff"
)

// Inventory tracks the current stock level for one product.
type Inventory struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"`
	ProductID        uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	Quantity         int       `gorm:"not null;default:0"`
	ReservedQuantity int       `gorm:"not null;default:0;column:reserved_quantity"`
	// Read-only: PostgreSQL GENERATED ALWAYS AS (quantity - reserved_quantity) STORED
	AvailableQuantity int       `gorm:"->;<-:false;column:available_quantity"`
	LowStockThreshold int       `gorm:"not null;default:0;column:low_stock_threshold"`
	CreatedAt         time.Time `gorm:"autoCreateTime"`
	UpdatedAt         time.Time `gorm:"autoUpdateTime"`
}

func (Inventory) TableName() string { return "inventory" }

// Movement is an immutable record of every stock change. Never updated.
type Movement struct {
	ID           uuid.UUID    `gorm:"type:uuid;primaryKey"`
	ProductID    uuid.UUID    `gorm:"type:uuid;not null;column:product_id"`
	MovementType MovementType `gorm:"type:inventory_movement_type;not null;column:movement_type"`
	// Quantity is always positive; movement_type determines direction.
	Quantity         int `gorm:"not null"`
	PreviousQuantity int `gorm:"not null;column:previous_quantity"`
	NewQuantity      int `gorm:"not null;column:new_quantity"`
	Reason           *string
	// Links paired transfer_out / transfer_in movements.
	ReferenceID *uuid.UUID `gorm:"type:uuid;column:reference_id"`
	CreatedBy   uuid.UUID  `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt   time.Time  `gorm:"autoCreateTime"`
}

func (Movement) TableName() string { return "inventory_movements" }

// ReceivingEdit records every edit to a purchase/receiving movement.
type ReceivingEdit struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	MovementID   uuid.UUID `gorm:"type:uuid;not null;column:movement_id"`
	EditedBy     uuid.UUID `gorm:"type:uuid;not null;column:edited_by"`
	OldProductID uuid.UUID `gorm:"type:uuid;not null;column:old_product_id"`
	NewProductID uuid.UUID `gorm:"type:uuid;not null;column:new_product_id"`
	OldQuantity  int       `gorm:"not null;column:old_quantity"`
	NewQuantity  int       `gorm:"not null;column:new_quantity"`
	OldUnitCost  float64   `gorm:"type:numeric(12,2);not null;column:old_unit_cost"`
	NewUnitCost  float64   `gorm:"type:numeric(12,2);not null;column:new_unit_cost"`
	OldNote      string    `gorm:"not null;column:old_note"`
	NewNote      string    `gorm:"not null;column:new_note"`
	EditedAt     time.Time `gorm:"autoCreateTime;column:edited_at"`
}

func (ReceivingEdit) TableName() string { return "inventory_receiving_edits" }

// Writeoff records damaged or lost stock that is removed from inventory.
type Writeoff struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ProductID  uuid.UUID  `gorm:"type:uuid;not null;column:product_id"`
	Quantity   int        `gorm:"not null"`
	Reason     string     `gorm:"not null"`
	ApprovedBy *uuid.UUID `gorm:"type:uuid;column:approved_by"`
	CreatedBy  uuid.UUID  `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt  time.Time  `gorm:"autoCreateTime"`
}

func (Writeoff) TableName() string { return "writeoffs" }

// Adjustment records a manual correction to inventory quantity.
type Adjustment struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"`
	ProductID        uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	PreviousQuantity int       `gorm:"not null;column:previous_quantity"`
	NewQuantity      int       `gorm:"not null;column:new_quantity"`
	Reason           string    `gorm:"not null"`
	CreatedBy        uuid.UUID `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt        time.Time `gorm:"autoCreateTime"`
}

func (Adjustment) TableName() string { return "inventory_adjustments" }

// Batch represents a lot of inventory received at a specific unit cost.
// remaining_quantity decreases as stock is consumed via FIFO.
type Batch struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ProductID         uuid.UUID  `gorm:"type:uuid;not null;column:product_id"`
	ReceivedQuantity  int        `gorm:"not null;column:received_quantity"`
	RemainingQuantity int        `gorm:"not null;column:remaining_quantity"`
	UnitCost          float64    `gorm:"type:numeric(12,2);not null;column:unit_cost"`
	ReceivedAt        time.Time  `gorm:"not null;column:received_at"`
	MovementID        *uuid.UUID `gorm:"type:uuid;column:movement_id"`
	CreatedBy         *uuid.UUID `gorm:"type:uuid;column:created_by"`
	CreatedAt         time.Time  `gorm:"autoCreateTime"`
}

func (Batch) TableName() string { return "inventory_batches" }

// BatchConsumption records how many units were consumed from a specific batch
// by a specific movement (writeoff, transfer_out, adjustment decrease).
type BatchConsumption struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	BatchID    uuid.UUID `gorm:"type:uuid;not null;column:batch_id"`
	MovementID uuid.UUID `gorm:"type:uuid;not null;column:movement_id"`
	Quantity   int       `gorm:"not null"`
	UnitCost   float64   `gorm:"type:numeric(12,2);not null;column:unit_cost"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

func (BatchConsumption) TableName() string { return "inventory_batch_consumptions" }
