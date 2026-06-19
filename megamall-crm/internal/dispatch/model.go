package dispatch

import (
	"time"

	"github.com/google/uuid"
)

// ─── Order Assignments ────────────────────────────────────────────────────────
//
// OrderAssignment is the authoritative record of who is currently responsible
// for delivering an order.
//
// Business rule: at most one row per order_id WHERE is_active=true.
// This is enforced by migration 00029 via a partial unique index.
// orders.courier_id is kept in sync as a query cache ONLY.

type OrderAssignment struct {
	ID           uuid.UUID  `gorm:"type:uuid;primaryKey"`
	OrderID      uuid.UUID  `gorm:"type:uuid;not null;column:order_id"`
	CourierID    uuid.UUID  `gorm:"type:uuid;not null;column:courier_id"`
	AssignedBy   uuid.UUID  `gorm:"type:uuid;not null;column:assigned_by"`
	AssignedAt   time.Time  `gorm:"column:assigned_at;not null;autoCreateTime"`
	UnassignedAt *time.Time `gorm:"column:unassigned_at"`
	IsActive     bool       `gorm:"column:is_active;not null;default:true"`
	Note         *string    `gorm:"type:text"`
}

func (OrderAssignment) TableName() string { return "order_assignments" }

// ─── Order Comments ───────────────────────────────────────────────────────────

type CommentVisibility string

const (
	VisibilityInternal       CommentVisibility = "internal"
	VisibilityCourierVisible CommentVisibility = "courier_visible"
	VisibilitySellerVisible  CommentVisibility = "seller_visible"
)

func (v CommentVisibility) IsValid() bool {
	switch v {
	case VisibilityInternal, VisibilityCourierVisible, VisibilitySellerVisible:
		return true
	}
	return false
}

// OrderComment is an immutable note attached to an order by a dispatcher.
// No updated_at — never modified after creation.
type OrderComment struct {
	ID         uuid.UUID         `gorm:"type:uuid;primaryKey"`
	OrderID    uuid.UUID         `gorm:"type:uuid;not null;column:order_id"`
	UserID     uuid.UUID         `gorm:"type:uuid;not null;column:user_id"`
	Comment    string            `gorm:"type:text;not null"`
	Visibility CommentVisibility `gorm:"type:comment_visibility;not null;default:internal"`
	CreatedAt  time.Time         `gorm:"autoCreateTime"`
}

func (OrderComment) TableName() string { return "order_comments" }
