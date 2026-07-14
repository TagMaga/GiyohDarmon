package orders

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ─── Enums ────────────────────────────────────────────────────────────────────

// OrderType represents who created the order and which commission rules apply.
type OrderType string

const (
	OrderTypeSeller        OrderType = "seller_order"
	OrderTypeManagerPersonal  OrderType = "manager_personal_order"
	OrderTypeTeamLeadPersonal OrderType = "team_lead_personal_order"
	// OrderTypeHouse is an owner-created order with no seller/team
	// attribution — no seller/manager/team-lead commission is paid on it.
	OrderTypeHouse OrderType = "house_order"
)

func (t OrderType) IsValid() bool {
	switch t {
	case OrderTypeSeller, OrderTypeManagerPersonal, OrderTypeTeamLeadPersonal, OrderTypeHouse:
		return true
	}
	return false
}

// OrderStatus represents the lifecycle stage of an order.
type OrderStatus string

const (
	StatusNew               OrderStatus = "new"
	StatusConfirmed         OrderStatus = "confirmed"
	StatusPrepaymentPending OrderStatus = "prepayment_pending"
	StatusPrepaymentReceived OrderStatus = "prepayment_received"
	StatusAssigned          OrderStatus = "assigned"
	StatusInDelivery        OrderStatus = "in_delivery"
	StatusDelivered         OrderStatus = "delivered"
	StatusReturned          OrderStatus = "returned"
	StatusCancelled         OrderStatus = "cancelled"
	StatusIssue             OrderStatus = "issue"
)

func (s OrderStatus) IsValid() bool {
	switch s {
	case StatusNew, StatusConfirmed, StatusPrepaymentPending, StatusPrepaymentReceived,
		StatusAssigned, StatusInDelivery, StatusDelivered, StatusReturned,
		StatusCancelled, StatusIssue:
		return true
	}
	return false
}

// IsTerminal returns true for statuses from which no transitions are allowed.
func (s OrderStatus) IsTerminal() bool {
	return s == StatusDelivered || s == StatusReturned || s == StatusCancelled
}

// allowedTransitions defines which target statuses are reachable from each source.
// This map is the single source of truth for the status engine.
//
// Correction 7 applied:
//   new → confirmed:  dispatcher / owner ONLY
//   new → cancelled:  creator / dispatcher / owner (enforced in service)
var allowedTransitions = map[OrderStatus][]OrderStatus{
	StatusNew: {
		StatusConfirmed,
		StatusCancelled,
	},
	StatusConfirmed: {
		StatusPrepaymentPending,
		StatusAssigned,
		StatusCancelled,
		StatusIssue,
	},
	StatusPrepaymentPending: {
		StatusPrepaymentReceived,
		StatusCancelled,
		StatusIssue,
	},
	StatusPrepaymentReceived: {
		StatusAssigned,
		StatusCancelled,
		StatusIssue,
	},
	StatusAssigned: {
		StatusInDelivery,
		StatusCancelled,
		StatusIssue,
		// Backward "unassign / recall" edge: dispatcher pulls the order back to the
		// confirmed pool. ChangeStatus releases the active assignment atomically (C1).
		StatusConfirmed,
	},
	StatusInDelivery: {
		StatusDelivered,
		StatusReturned,
		StatusIssue,
		// Backward "recall" edge (also legitimises legacy in_delivery→confirmed data).
		// Assignment is released atomically by ChangeStatus (C1).
		StatusConfirmed,
	},
	StatusIssue: {
		StatusConfirmed,
		StatusPrepaymentPending,
		StatusAssigned,
		StatusCancelled,
	},
	// Terminal states — no outbound transitions.
	StatusDelivered: {},
	StatusReturned:  {},
	StatusCancelled: {},
}

// CanTransition returns true if moving from → to is a valid state machine step.
func CanTransition(from, to OrderStatus) bool {
	targets, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}

// ─── Domain models ────────────────────────────────────────────────────────────

// CustomerInfo is a read-only projection of the customers table used for embedding
// in order responses. GORM preloads it via the CustomerID foreign key.
type CustomerInfo struct {
	ID       uuid.UUID `gorm:"primaryKey"`
	FullName string    `gorm:"column:full_name"`
	Phone    string    `gorm:"column:phone"`
	City     *string   `gorm:"column:city"`
	Address  *string   `gorm:"column:address"`
}

func (CustomerInfo) TableName() string { return "customers" }

// SellerInfo is a read-only projection of the users table for the order creator.
type SellerInfo struct {
	ID       uuid.UUID `gorm:"primaryKey"`
	FullName string    `gorm:"column:full_name"`
	Phone    string    `gorm:"column:phone"`
}

func (SellerInfo) TableName() string { return "users" }

// Order is the central domain entity for Phase 4.
type Order struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	// default:(-) tells GORM to omit this column on INSERT so the DB sequence fires.
	OrderNumber string `gorm:"column:order_number;not null;uniqueIndex;default:(-)"`

	CustomerID uuid.UUID `gorm:"type:uuid;not null;column:customer_id"`
	// seller_id = the user who created the order regardless of order_type.
	SellerID uuid.UUID `gorm:"type:uuid;not null;column:seller_id"`

	// Hierarchy snapshot — frozen at creation, never recalculated.
	ManagerID      *uuid.UUID `gorm:"type:uuid;column:manager_id"`
	TeamLeadID     *uuid.UUID `gorm:"type:uuid;column:team_lead_id"`
	ManagerTeamID  *uuid.UUID `gorm:"type:uuid;column:manager_team_id"`
	TeamLeadTeamID *uuid.UUID `gorm:"type:uuid;column:team_lead_team_id"`

	OrderType  OrderType   `gorm:"type:order_type;not null;column:order_type"`
	Status     OrderStatus `gorm:"type:order_status;not null;default:new"`
	SnapshotID *uuid.UUID  `gorm:"type:uuid;column:snapshot_id"`

	// CityID is the delivery city (cities table). Required at creation; used by the
	// courier app to filter available orders by the courier's assigned cities.
	CityID *uuid.UUID `gorm:"type:uuid;column:city_id"`

	// Delivery method chosen by seller: "normal" | "fast"
	DeliveryMethod string `gorm:"column:delivery_method;not null;default:normal"`

	// CourierPayout is paid from company margin to the assigned courier. Frozen at
	// assignment/delivery (Phase 4) via ResolveCourierPayout. 0 until then.
	CourierPayout float64 `gorm:"type:numeric(12,2);not null;default:0;column:courier_payout"`

	// Financials:
	//   subtotal          = sum of order item prices (product total)
	//   total_amount      = subtotal  (same; delivery NOT added — kept for commission base)
	//   delivery_fee      = fee from delivery_settings based on delivery_method
	//   net_revenue       = total_amount - delivery_fee  (base for all commissions)
	//   total_order_amount = total_amount + delivery_fee (what client actually pays)
	//   amount_to_collect  = total_order_amount - prepayment_amount
	Subtotal          float64 `gorm:"type:numeric(12,2);not null;default:0"`
	DeliveryFee       float64 `gorm:"type:numeric(12,2);not null;default:0;column:delivery_fee"`
	TotalAmount       float64 `gorm:"type:numeric(12,2);not null;default:0;column:total_amount"`
	NetRevenue        float64 `gorm:"type:numeric(12,2);not null;default:0;column:net_revenue"`
	PrepaymentAmount  float64 `gorm:"type:numeric(12,2);not null;default:0;column:prepayment_amount"`

	// Prepayment verification flow (Migration 00040)
	PrepaymentRequired        bool       `gorm:"not null;default:false;column:prepayment_required"`
	PrepaymentType            *string    `gorm:"column:prepayment_type"`            // "partial" | "full"
	PrepaymentStatus          string     `gorm:"not null;default:none;column:prepayment_status"` // none|pending_verification|verified|rejected
	PrepaymentReceiver        *string    `gorm:"column:prepayment_receiver"`        // dispatcher_card|company_card|cash|other
	PrepaymentComment         *string    `gorm:"column:prepayment_comment"`
	PrepaymentVerifiedBy      *uuid.UUID `gorm:"type:uuid;column:prepayment_verified_by"`
	PrepaymentVerifiedAt      *time.Time `gorm:"column:prepayment_verified_at"`
	PrepaymentRejectionReason *string    `gorm:"column:prepayment_rejection_reason"`

	Notes           *string `gorm:"type:text"`
	DeliveryAddress *string `gorm:"type:text;column:delivery_address"`
	CreatedAt       time.Time  `gorm:"autoCreateTime"`
	UpdatedAt time.Time  `gorm:"autoUpdateTime"`
	DeletedAt *time.Time `gorm:"index"`

	// Phase 5: courier assignment cache.
	// SOURCE OF TRUTH is order_assignments WHERE is_active=true.
	// courier_id here is kept in sync as a query-optimisation cache only.
	CourierID   *uuid.UUID `gorm:"type:uuid;column:courier_id"`
	ScheduledAt *time.Time `gorm:"column:scheduled_at"`

	// Associations (optional preload)
	Customer    *CustomerInfo     `gorm:"foreignKey:CustomerID;references:ID"`
	Seller      *SellerInfo       `gorm:"foreignKey:SellerID;references:ID"`
	Items       []OrderItem       `gorm:"foreignKey:OrderID;references:ID"`
	Attachments []OrderAttachment `gorm:"foreignKey:OrderID;references:ID"`
}

// PrepaymentStatus constants.
const (
	PrepaymentStatusNone                = "none"
	PrepaymentStatusPendingVerification = "pending_verification"
	PrepaymentStatusVerified            = "verified"
	PrepaymentStatusRejected            = "rejected"
)

// OrderAttachment stores proof files for prepayment verification.
type OrderAttachment struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	OrderID    uuid.UUID `gorm:"type:uuid;not null;column:order_id"`
	Type       string    `gorm:"not null"` // "payment_proof" | "customer_chat" | "other"
	FileURL    string    `gorm:"not null;column:file_url"`
	UploadedBy uuid.UUID `gorm:"type:uuid;not null;column:uploaded_by"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

func (OrderAttachment) TableName() string { return "order_attachments" }

func (Order) TableName() string { return "orders" }

// OrderItem stores a price snapshot per product line — never read from products table again.
type OrderItem struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	OrderID     uuid.UUID `gorm:"type:uuid;not null;column:order_id"`
	ProductID   uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	Quantity    int       `gorm:"not null"`
	UnitPrice   float64   `gorm:"type:numeric(12,2);not null;column:unit_price"`
	TotalPrice  float64   `gorm:"type:numeric(12,2);not null;column:total_price"`
	// ProductName and ProductImageURL are populated at query time — not stored.
	ProductName     string  `gorm:"column:product_name;<-:false"`
	ProductImageURL *string `gorm:"column:product_image_url;<-:false"`
}

func (OrderItem) TableName() string { return "order_items" }

// OrderTimeline is an immutable record of every status transition.
type OrderTimeline struct {
	ID         uuid.UUID    `gorm:"type:uuid;primaryKey"`
	OrderID    uuid.UUID    `gorm:"type:uuid;not null;column:order_id"`
	FromStatus *OrderStatus `gorm:"type:order_status;column:from_status"` // nil for initial entry
	ToStatus   OrderStatus  `gorm:"type:order_status;not null;column:to_status"`
	Comment    *string
	CreatedBy  uuid.UUID `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
	// ActorName is populated at query time via LEFT JOIN users — not stored.
	ActorName  string    `gorm:"column:actor_name;<-:false"`
}

func (OrderTimeline) TableName() string { return "order_timeline" }

// OrderPrepayment records a partial payment with optional verification.
type OrderPrepayment struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	OrderID    uuid.UUID  `gorm:"type:uuid;not null;column:order_id"`
	Amount     float64    `gorm:"type:numeric(12,2);not null"`
	ProofURL   *string    `gorm:"column:proof_url"`
	VerifiedBy *uuid.UUID `gorm:"type:uuid;column:verified_by"`
	VerifiedAt *time.Time `gorm:"column:verified_at"`
	CreatedBy  uuid.UUID  `gorm:"type:uuid;not null;column:created_by"`
	CreatedAt  time.Time  `gorm:"autoCreateTime"`
}

func (OrderPrepayment) TableName() string { return "order_prepayments" }

// ErrInvalidTransition is returned when the requested status change is not
// permitted by the state machine.
type ErrInvalidTransition struct {
	From OrderStatus
	To   OrderStatus
}

func (e *ErrInvalidTransition) Error() string {
	return fmt.Sprintf("invalid transition: %s → %s", e.From, e.To)
}
