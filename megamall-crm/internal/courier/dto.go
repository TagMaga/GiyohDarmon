package courier

import (
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/orders"
)

// ─── Requests ─────────────────────────────────────────────────────────────────

type StatusChangeRequest struct {
	Comment *string `json:"comment"`
}

type AddressChangedRequest struct {
	NewAddress string `json:"new_address"`
}

type DeferOrderRequest struct {
	ScheduledAt time.Time `json:"scheduled_at"`
}

type AddNoteRequest struct {
	Note string `json:"note" validate:"required,min=1"`
}

type AddAttemptRequest struct {
	Result  AttemptResult `json:"result"  validate:"required"`
	Comment *string       `json:"comment"`
}

type UpdateCourierStatusRequest struct {
	Status    CourierOnlineStatus `json:"status"    validate:"required"`
	Latitude  *float64            `json:"latitude"`
	Longitude *float64            `json:"longitude"`
}

type RegisterPushTokenRequest struct {
	Token    string `json:"token"    validate:"required"`
	Platform string `json:"platform" validate:"required,oneof=ios android unknown"`
}

type SubmitHandoverRequest struct {
	ProofURL        *string  `json:"proof_url"`
	AttachmentsJSON *string  `json:"attachments_json"`
	Notes           *string  `json:"notes"`
	ActualAmount    *float64 `json:"actual_amount"`
}

type ConfirmHandoverRequest struct {
	ActualReturned float64 `json:"actual_returned" validate:"min=0"`
	Comment        *string `json:"comment"`
}

type RejectHandoverRequest struct {
	Comment   string  `json:"comment"    validate:"required,min=1"`
	AdminNote *string `json:"admin_note"`
}

// ─── Responses ────────────────────────────────────────────────────────────────

type OrderCustomer struct {
	FullName string  `json:"full_name"`
	Phone    string  `json:"phone"`
	Address  *string `json:"address"`
}

type OrderItemResponse struct {
	ProductID   uuid.UUID `json:"product_id"`
	ProductName string    `json:"product_name"`
	Quantity    int       `json:"quantity"`
	UnitPrice   float64   `json:"unit_price"`
	TotalPrice  float64   `json:"total_price"`
}

// MyOrderResponse is a courier's order with customer details for the mobile app.
type MyOrderResponse struct {
	ID                   uuid.UUID           `json:"id"`
	OrderNumber          string              `json:"order_number"`
	Status               orders.OrderStatus  `json:"status"`
	Customer             OrderCustomer       `json:"customer"`
	CreatorID            *uuid.UUID          `json:"creator_id"`
	CreatorName          string              `json:"creator_name"`
	CreatorPhone         string              `json:"creator_phone"`
	CreatorRole          string              `json:"creator_role"` // raw role; localized label resolved on the client
	DeliveryMethod       string              `json:"delivery_method"`
	ProductTotal         float64             `json:"product_total"`
	DeliveryFee          float64             `json:"delivery_fee"`
	PrepaymentAmount     float64             `json:"prepayment_amount"`
	TotalOrderAmount     float64             `json:"total_order_amount"`
	AmountToCollect      float64             `json:"amount_to_collect"`
	CourierCollectAmount float64             `json:"courier_collect_amount"` // = AmountToCollect
	PaymentLabel         string              `json:"payment_label"`
	ScheduledAt          *time.Time          `json:"scheduled_at"`
	AssignedAt           *time.Time          `json:"assigned_at"`
	Notes                *string             `json:"notes"`
	Items                []OrderItemResponse `json:"items"`
}

// CashSummaryResponse uses field names matching the courier mobile app.
type CashSummaryResponse struct {
	OrdersCollected   int     `json:"orders_collected"`
	CashToHandover    float64 `json:"cash_to_handover"`    // debt — excludes only CONFIRMED handovers
	TotalDeliveryFees float64 `json:"total_delivery_fees"` // courier earnings on still-owed orders
	AlreadyHanded     float64 `json:"already_handed"`      // confirmed handovers today
	PendingAmount     float64 `json:"pending_amount"`      // submitted, awaiting dispatcher confirmation
}

// CourierMeResponse is the profile response for GET /courier/me.
type CourierMeResponse struct {
	ID                 uuid.UUID `json:"id"`
	FullName           string    `json:"full_name"`
	Phone              string    `json:"phone"`
	Email              *string   `json:"email"`
	Role               string    `json:"role"`
	OrderIntakeEnabled bool      `json:"order_intake_enabled"`
	OrderIntakeReason  *string   `json:"order_intake_reason,omitempty"`
}

type NoteResponse struct {
	ID        uuid.UUID `json:"id"`
	OrderID   uuid.UUID `json:"order_id"`
	CourierID uuid.UUID `json:"courier_id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

func NoteToResponse(n *CourierNote) NoteResponse {
	return NoteResponse{
		ID:        n.ID,
		OrderID:   n.OrderID,
		CourierID: n.CourierID,
		Note:      n.Note,
		CreatedAt: n.CreatedAt,
	}
}

type AttemptResponse struct {
	ID        uuid.UUID     `json:"id"`
	OrderID   uuid.UUID     `json:"order_id"`
	CourierID uuid.UUID     `json:"courier_id"`
	AttemptNo int           `json:"attempt_no"`
	Result    AttemptResult `json:"result"`
	Comment   *string       `json:"comment"`
	CreatedAt time.Time     `json:"created_at"`
}

func AttemptToResponse(a *DeliveryAttempt) AttemptResponse {
	return AttemptResponse{
		ID:        a.ID,
		OrderID:   a.OrderID,
		CourierID: a.CourierID,
		AttemptNo: a.AttemptNo,
		Result:    a.Result,
		Comment:   a.Comment,
		CreatedAt: a.CreatedAt,
	}
}

type HandoverResponse struct {
	ID                uuid.UUID           `json:"id"`
	CourierID         uuid.UUID           `json:"courier_id"`
	DispatcherID      *uuid.UUID          `json:"dispatcher_id"`
	TotalCollected    float64             `json:"total_collected"`
	TotalDeliveryFees float64             `json:"total_delivery_fees"`
	TotalToReturn     float64             `json:"total_to_return"`
	ActualReturned    *float64            `json:"actual_returned"`
	Status            HandoverStatus      `json:"status"`
	ProofURL          *string             `json:"proof_url"`
	AttachmentsJSON   *string             `json:"attachments_json"`
	Comment           *string             `json:"comment"`
	AdminNote         *string             `json:"admin_note"`
	ConfirmedAt       *time.Time          `json:"confirmed_at"`
	CreatedAt         time.Time           `json:"created_at"`
	Orders            []HandoverOrderLine `json:"orders,omitempty"`
}

type HandoverOrderLine struct {
	OrderID          uuid.UUID `json:"order_id"`
	OrderTotal       float64   `json:"order_total"`
	PrepaymentAmount float64   `json:"prepayment_amount"`
	CourierCollected float64   `json:"courier_collected"`
	DeliveryFee      float64   `json:"delivery_fee"`
	CourierReturns   float64   `json:"courier_returns"`
}

func HandoverToResponse(h *CashHandover) HandoverResponse {
	lines := make([]HandoverOrderLine, 0, len(h.Orders))
	for _, o := range h.Orders {
		lines = append(lines, HandoverOrderLine{
			OrderID:          o.OrderID,
			OrderTotal:       o.OrderTotal,
			PrepaymentAmount: o.PrepaymentAmount,
			CourierCollected: o.CourierCollected,
			DeliveryFee:      o.DeliveryFee,
			CourierReturns:   o.CourierReturns,
		})
	}
	return HandoverResponse{
		ID:                h.ID,
		CourierID:         h.CourierID,
		DispatcherID:      h.DispatcherID,
		TotalCollected:    h.TotalCollected,
		TotalDeliveryFees: h.TotalDeliveryFees,
		TotalToReturn:     h.TotalToReturn,
		ActualReturned:    h.ActualReturned,
		Status:            h.Status,
		ProofURL:          h.ProofURL,
		AttachmentsJSON:   h.AttachmentsJSON,
		Comment:           h.Comment,
		AdminNote:         h.AdminNote,
		ConfirmedAt:       h.ConfirmedAt,
		CreatedAt:         h.CreatedAt,
		Orders:            lines,
	}
}
