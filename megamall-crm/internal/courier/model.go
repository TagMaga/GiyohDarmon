package courier

import (
	"time"

	"github.com/google/uuid"
)

// ─── Courier Notes ────────────────────────────────────────────────────────────

// CourierNote is an immutable note appended by a courier on their assigned order.
type CourierNote struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	OrderID   uuid.UUID `gorm:"type:uuid;not null;column:order_id"`
	CourierID uuid.UUID `gorm:"type:uuid;not null;column:courier_id"`
	Note      string    `gorm:"type:text;not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

func (CourierNote) TableName() string { return "courier_notes" }

// ─── Cash Handovers ───────────────────────────────────────────────────────────

type HandoverStatus string

const (
	HandoverStatusPending   HandoverStatus = "pending"
	HandoverStatusConfirmed HandoverStatus = "confirmed"
	HandoverStatusRejected  HandoverStatus = "rejected"
	HandoverStatusDisputed  HandoverStatus = "disputed"
)

func (s HandoverStatus) IsValid() bool {
	switch s {
	case HandoverStatusPending, HandoverStatusConfirmed, HandoverStatusRejected, HandoverStatusDisputed:
		return true
	}
	return false
}

// CashHandover records a courier's submitted cash for dispatcher reconciliation.
type CashHandover struct {
	ID                uuid.UUID      `gorm:"type:uuid;primaryKey"`
	CourierID         uuid.UUID      `gorm:"type:uuid;not null;column:courier_id"`
	DispatcherID      *uuid.UUID     `gorm:"type:uuid;column:dispatcher_id"`
	TotalCollected    float64        `gorm:"type:numeric(12,2);not null;column:total_collected"`
	TotalDeliveryFees float64        `gorm:"type:numeric(12,2);not null;column:total_delivery_fees"`
	TotalToReturn     float64        `gorm:"type:numeric(12,2);not null;column:total_to_return"`
	ActualReturned    *float64       `gorm:"type:numeric(12,2);column:actual_returned"`
	Status            HandoverStatus `gorm:"type:handover_status;not null;default:pending"`
	ProofURL          *string        `gorm:"column:proof_url"`
	Comment           *string        `gorm:"type:text"`
	AdminNote         *string        `gorm:"type:text;column:admin_note"`
	AttachmentsJSON   *string        `gorm:"type:text;column:attachments_json"`
	ConfirmedAt       *time.Time     `gorm:"column:confirmed_at"`
	CreatedAt         time.Time      `gorm:"autoCreateTime"`

	Orders []CashHandoverOrder `gorm:"foreignKey:HandoverID;references:ID"`
}

func (CashHandover) TableName() string { return "cash_handovers" }

// CashHandoverOrder is a line item linking a delivered order to a handover.
type CashHandoverOrder struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"`
	HandoverID       uuid.UUID `gorm:"type:uuid;not null;column:handover_id"`
	OrderID          uuid.UUID `gorm:"type:uuid;not null;column:order_id"`
	OrderTotal       float64   `gorm:"type:numeric(12,2);not null;column:order_total"`
	PrepaymentAmount float64   `gorm:"type:numeric(12,2);not null;column:prepayment_amount"`
	CourierCollected float64   `gorm:"type:numeric(12,2);not null;column:courier_collected"`
	DeliveryFee      float64   `gorm:"type:numeric(12,2);not null;column:delivery_fee"`
	CourierReturns   float64   `gorm:"type:numeric(12,2);not null;column:courier_returns"`
}

func (CashHandoverOrder) TableName() string { return "cash_handover_orders" }

// ─── Courier Status Log ───────────────────────────────────────────────────────

type CourierOnlineStatus string

const (
	CourierStatusOnline  CourierOnlineStatus = "online"
	CourierStatusOffline CourierOnlineStatus = "offline"
	CourierStatusBusy    CourierOnlineStatus = "busy"
)

func (s CourierOnlineStatus) IsValid() bool {
	switch s {
	case CourierStatusOnline, CourierStatusOffline, CourierStatusBusy:
		return true
	}
	return false
}

// CourierStatusLog is an immutable append-only availability log.
// The most recent row per courier_id is the current status.
type CourierStatusLog struct {
	ID        uuid.UUID           `gorm:"type:uuid;primaryKey"`
	CourierID uuid.UUID           `gorm:"type:uuid;not null;column:courier_id"`
	Status    CourierOnlineStatus `gorm:"type:courier_online_status;not null"`
	Latitude  *float64            `gorm:"type:numeric(10,7)"`
	Longitude *float64            `gorm:"type:numeric(10,7)"`
	CreatedAt time.Time           `gorm:"autoCreateTime"`
}

func (CourierStatusLog) TableName() string { return "courier_status_logs" }

// ─── Delivery Attempts ────────────────────────────────────────────────────────

type AttemptResult string

const (
	AttemptNoAnswer          AttemptResult = "no_answer"
	AttemptBusy              AttemptResult = "busy"
	AttemptRescheduled       AttemptResult = "rescheduled"
	AttemptWrongAddress      AttemptResult = "wrong_address"
	AttemptCustomerCancelled AttemptResult = "customer_cancelled"
	AttemptRefused           AttemptResult = "refused"
	AttemptOther             AttemptResult = "other"
)

func (r AttemptResult) IsValid() bool {
	switch r {
	case AttemptNoAnswer, AttemptBusy, AttemptRescheduled, AttemptWrongAddress,
		AttemptCustomerCancelled, AttemptRefused, AttemptOther:
		return true
	}
	return false
}

// DeliveryAttempt records a single delivery try for an order.
// attempt_no is set by counting prior attempts + 1 at write time.
type DeliveryAttempt struct {
	ID        uuid.UUID     `gorm:"type:uuid;primaryKey"`
	OrderID   uuid.UUID     `gorm:"type:uuid;not null;column:order_id"`
	CourierID uuid.UUID     `gorm:"type:uuid;not null;column:courier_id"`
	AttemptNo int           `gorm:"not null;column:attempt_no"`
	Result    AttemptResult `gorm:"type:delivery_attempt_result;not null"`
	Comment   *string       `gorm:"type:text"`
	CreatedAt time.Time     `gorm:"autoCreateTime"`
}

func (DeliveryAttempt) TableName() string { return "delivery_attempts" }
