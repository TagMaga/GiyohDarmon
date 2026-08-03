package notifications

import (
	"time"

	"github.com/google/uuid"
)

// Type identifies which of the fixed set of notification events produced a
// row — used by clients to pick an icon/deep-link, not for RBAC.
type Type string

const (
	TypeCourierAssigned     Type = "courier_assigned"
	TypeOrderComment        Type = "order_comment"
	TypeCashReturnDue       Type = "cash_return_due"
	TypeWarehousePickup     Type = "warehouse_pickup"
	TypeOrdersAvailable     Type = "orders_available"
	TypePrepaymentSubmitted Type = "prepayment_submitted"
)

// Notification is a single persisted, per-user event. Also best-effort
// pushed via Expo when the recipient has a row in courier_push_tokens.
type Notification struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;column:user_id"`
	Type      Type       `gorm:"type:varchar(40);not null"`
	Title     string     `gorm:"not null"`
	Body      string     `gorm:"not null"`
	OrderID   *uuid.UUID `gorm:"type:uuid;column:order_id"`
	ReadAt    *time.Time `gorm:"column:read_at"`
	CreatedAt time.Time  `gorm:"autoCreateTime;column:created_at"`
}

func (Notification) TableName() string { return "notifications" }
