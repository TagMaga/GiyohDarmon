package dispatch

import (
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/orders"
)

// ─── Board ────────────────────────────────────────────────────────────────────

// BoardOrder is the dispatcher board projection: order + current assignment.
type BoardOrder struct {
	OrderID      uuid.UUID          `json:"order_id"`
	OrderNumber  string             `json:"order_number"`
	Status       orders.OrderStatus `json:"status"`
	CustomerID   uuid.UUID          `json:"customer_id"`
	TotalAmount  float64            `json:"total_amount"`
	DeliveryFee  float64            `json:"delivery_fee"`
	ScheduledAt  *time.Time         `json:"scheduled_at"`
	CourierID    *uuid.UUID         `json:"courier_id"`
	AssignmentID *uuid.UUID         `json:"assignment_id"`
	AssignedAt   *time.Time         `json:"assigned_at"`
	Notes        *string            `json:"notes"`
	CreatedAt    time.Time          `json:"created_at"`
}

// UpdateCourierRequest is the dispatcher payload to edit a courier's profile.
type UpdateCourierRequest struct {
	FullName       string      `json:"full_name"        validate:"required,min=1"`
	Surname        *string     `json:"surname"`
	Phone          string      `json:"phone"            validate:"required"`
	Password       *string     `json:"password"` // empty = keep existing
	TelegramChatID *string     `json:"telegram_chat_id" validate:"required"`
	CityIDs        []uuid.UUID `json:"city_ids"` // nil = unchanged; empty slice = remove all
}

// ToggleCourierActiveRequest toggles the courier's is_active flag.
type ToggleCourierActiveRequest struct {
	Active bool `json:"active"`
}

// CourierProfileResponse is returned after edit/toggle operations.
type CourierProfileResponse struct {
	CourierID      uuid.UUID   `json:"courier_id"`
	FullName       string      `json:"full_name"`
	Surname        *string     `json:"surname"`
	Phone          string      `json:"phone"`
	TelegramChatID *string     `json:"telegram_chat_id"`
	IsActive       bool        `json:"is_active"`
	CityIDs        []uuid.UUID `json:"city_ids"`
}

// CourierOverview is a per-courier workload summary for the board sidebar.
// CourierOverview reports a courier's live workload. Order-count definitions are
// the single source of truth shared by the board, the couriers page and the
// courier app (H2):
//
//	AssignedOrders = orders in status 'assigned'      (accepted, not yet started)
//	InDelivery     = orders in status 'in_delivery'   (en route)
//	IssueOrders    = orders in status 'issue'         (held by courier, flagged)
//	ActiveOrders   = AssignedOrders + InDelivery + IssueOrders
//	               = every order the courier currently holds and has not yet
//	                 delivered/returned. Used for the N/6 capacity gauge so a
//	                 courier with held orders never shows as free.
type CourierOverview struct {
	CourierID            uuid.UUID   `json:"courier_id"`
	FullName             string      `json:"full_name"`
	Surname              *string     `json:"surname,omitempty"`
	TelegramChatID       *string     `json:"telegram_chat_id,omitempty"`
	Phone                string      `json:"phone"`
	IsActive             bool        `json:"is_active"`
	ActiveOrders         int         `json:"active_orders"`   // assigned + in_delivery + issue
	AssignedOrders       int         `json:"assigned_orders"` // status = assigned
	InDelivery           int         `json:"in_delivery"`     // status = in_delivery
	IssueOrders          int         `json:"issue_orders"`    // status = issue
	CashOwed             float64     `json:"cash_owed"`       // sum of (total_amount - prepayment) for delivered, not-yet-handovered
	OrderIntakeEnabled   bool        `json:"order_intake_enabled"`
	OrderIntakeReason    *string     `json:"order_intake_reason,omitempty"`
	OrderIntakeUpdatedAt *time.Time  `json:"order_intake_updated_at,omitempty"`
	CityIDs              []uuid.UUID `json:"city_ids"`
	CityNames            []string    `json:"city_names"`
}

// CashSettlementFilter scopes courier settlement metrics. Nil From/To means
// all time, which is the default dispatcher view.
type CashSettlementFilter struct {
	From      *time.Time
	To        *time.Time
	CourierID *uuid.UUID
}

// CashSettlementRow is the dispatcher cash tab's per-courier performance and
// settlement projection for the selected period.
type CashSettlementRow struct {
	CourierID          uuid.UUID `json:"courier_id"`
	CourierName        string    `json:"courier_name"`
	CourierPhone       string    `json:"courier_phone"`
	IsOnline           bool      `json:"is_online"`
	ActiveOrders       int       `json:"active_orders"`
	Delivered          int       `json:"delivered"`
	Failed             int       `json:"failed"`
	SuccessRate        *float64  `json:"success_rate"`
	AvgDeliverySeconds *int      `json:"avg_delivery_seconds"`
	CashDebt           float64   `json:"cash_debt"`
	Earnings           float64   `json:"earnings"`
}

type CashTransactionFilter struct {
	From      *time.Time
	To        *time.Time
	CourierID *uuid.UUID
	Status    string
	AmountMin *float64
	AmountMax *float64
}

type CashTransactionRow struct {
	ID              uuid.UUID  `json:"id"`
	CourierID       uuid.UUID  `json:"courier_id"`
	CourierName     string     `json:"courier_name"`
	CourierPhone    string     `json:"courier_phone"`
	CreatedAt       time.Time  `json:"created_at"`
	Amount          float64    `json:"amount"`
	Status          string     `json:"status"`
	Note            *string    `json:"note"`
	RejectionReason *string    `json:"rejection_reason"`
	PhotoURL        *string    `json:"photo_url"`
	ConfirmedBy     *uuid.UUID `json:"confirmed_by"`
	ConfirmedAt     *time.Time `json:"confirmed_at"`
	// MediaAssets is resolved fresh at request time by the handler (never
	// scanned from SQL) — see courier.Service.ResolveCashHandoverMediaAssets.
	// PhotoURL above only reflects the legacy proof_url column, which is
	// empty for handovers submitted through the media pipeline.
	MediaAssets []courier.HandoverMediaAsset `json:"media_assets,omitempty"`
}

type OrderHistoryFilter struct {
	From      *time.Time
	To        *time.Time
	CourierID *uuid.UUID
	SellerID  *uuid.UUID
	ProductID *uuid.UUID
	Status    orders.OrderStatus
	Product   string
	Seller    string
	Search    string
}

type OrderHistoryProduct struct {
	ProductID uuid.UUID `json:"product_id"`
	Name      string    `json:"name"`
	Quantity  int       `json:"quantity"`
}

type OrderHistoryRow struct {
	ID                 uuid.UUID             `json:"id"`
	OrderNumber        string                `json:"order_number"`
	CreatedAt          time.Time             `json:"created_at"`
	Status             orders.OrderStatus    `json:"status"`
	Products           []OrderHistoryProduct `json:"products"`
	CourierID          *uuid.UUID            `json:"courier_id"`
	CourierName        *string               `json:"courier_name"`
	CourierPhone       *string               `json:"courier_phone"`
	SellerID           uuid.UUID             `json:"seller_id"`
	SellerName         string                `json:"seller_name"`
	TotalAmount        float64               `json:"total_amount"`
	DeliveryFee        float64               `json:"delivery_fee"`
	CourierPayout      float64               `json:"courier_payout"`
	DeliveredAt        *time.Time            `json:"delivered_at"`
	ProcessSeconds     *int                  `json:"process_seconds"`
	CancellationReason *string               `json:"cancellation_reason"`
	CustomerName       string                `json:"customer_name"`
	CustomerPhone      string                `json:"customer_phone"`
	DeliveryAddress    *string               `json:"delivery_address"`
}

// ─── Requests ─────────────────────────────────────────────────────────────────

type AssignCourierRequest struct {
	CourierID uuid.UUID `json:"courier_id" validate:"required"`
	Note      *string   `json:"note"`
}

type ScheduleOrderRequest struct {
	ScheduledAt time.Time `json:"scheduled_at" validate:"required"`
}

type AddCommentRequest struct {
	Comment    string            `json:"comment"    validate:"required,min=1"`
	Visibility CommentVisibility `json:"visibility" validate:"required"`
}

type ResolveIssueRequest struct {
	ToStatus orders.OrderStatus `json:"to_status" validate:"required"`
	Comment  *string            `json:"comment"`
}

type StatusChangeRequest struct {
	Comment *string `json:"comment"`
}

type ConfirmHandoverRequest struct {
	// max=1000000 is a fat-finger/overflow guard on cash-in-hand, not a real
	// business ceiling.
	ActualReturned float64 `json:"actual_returned" validate:"min=0,max=1000000"`
	Comment        *string `json:"comment"`
}

type RejectHandoverRequest struct {
	Comment string `json:"comment" validate:"required,min=1"`
}

type RejectCashTransactionRequest struct {
	Reason string `json:"reason" validate:"required,min=1"`
}

type UpdateCourierOrderIntakeRequest struct {
	Enabled *bool   `json:"enabled"`
	Reason  *string `json:"reason"`
}

// ─── Responses ────────────────────────────────────────────────────────────────

type AssignmentResponse struct {
	ID         uuid.UUID `json:"id"`
	OrderID    uuid.UUID `json:"order_id"`
	CourierID  uuid.UUID `json:"courier_id"`
	AssignedBy uuid.UUID `json:"assigned_by"`
	AssignedAt time.Time `json:"assigned_at"`
	IsActive   bool      `json:"is_active"`
	Note       *string   `json:"note"`
}

func AssignmentToResponse(a *OrderAssignment) AssignmentResponse {
	return AssignmentResponse{
		ID:         a.ID,
		OrderID:    a.OrderID,
		CourierID:  a.CourierID,
		AssignedBy: a.AssignedBy,
		AssignedAt: a.AssignedAt,
		IsActive:   a.IsActive,
		Note:       a.Note,
	}
}

type CommentResponse struct {
	ID         uuid.UUID         `json:"id"`
	OrderID    uuid.UUID         `json:"order_id"`
	UserID     uuid.UUID         `json:"user_id"`
	Comment    string            `json:"comment"`
	Visibility CommentVisibility `json:"visibility"`
	CreatedAt  time.Time         `json:"created_at"`
}

func CommentToResponse(c *OrderComment) CommentResponse {
	return CommentResponse{
		ID:         c.ID,
		OrderID:    c.OrderID,
		UserID:     c.UserID,
		Comment:    c.Comment,
		Visibility: c.Visibility,
		CreatedAt:  c.CreatedAt,
	}
}

// ─── Sellers ──────────────────────────────────────────────────────────────────

// SellerInfo is a minimal seller record for the dispatcher's seller dropdown.
type SellerInfo struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
	Phone    string    `json:"phone"`
}
