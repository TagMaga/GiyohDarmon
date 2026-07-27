package dispatcher_settlements

import (
	"time"

	"github.com/google/uuid"
)

// Settlement is one dispatcher->company cash remittance submission.
// Received (from cash_handovers) minus confirmed Settlements is the
// dispatcher's running debt to the company.
type Settlement struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey"`
	DispatcherID    uuid.UUID `gorm:"type:uuid;not null;column:dispatcher_id"`
	Amount          float64   `gorm:"type:numeric(12,2);not null;column:amount"`
	Status          string    `gorm:"type:settlement_status;not null;default:pending;column:status"` // pending | confirmed | rejected
	Comment         *string   `gorm:"column:comment"`
	RejectionReason *string   `gorm:"column:rejection_reason"`
	// ActualReceived is what the owner counted on confirm — may differ from
	// Amount (the dispatcher's declared figure), same expected-vs-actual
	// shortfall pattern as cash_handovers.actual_returned.
	ActualReceived *float64   `gorm:"column:actual_received"`
	AdminNote      *string    `gorm:"column:admin_note"`
	ReviewedBy     *uuid.UUID `gorm:"type:uuid;column:reviewed_by"`
	ReviewedAt     *time.Time `gorm:"column:reviewed_at"`
	CreatedAt      time.Time  `gorm:"autoCreateTime;column:created_at"`
}

func (Settlement) TableName() string { return "dispatcher_settlements" }

const (
	StatusPending   = "pending"
	StatusConfirmed = "confirmed"
	StatusRejected  = "rejected"
)
