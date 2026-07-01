package orders

import (
	"time"

	"github.com/google/uuid"
)

// ─── Order Items ──────────────────────────────────────────────────────────────

type OrderItemRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity"   validate:"required,min=1"`
	UnitPrice float64   `json:"unit_price"  validate:"required,min=0"`
}

type OrderItemResponse struct {
	ID              uuid.UUID `json:"id"`
	ProductID       uuid.UUID `json:"product_id"`
	ProductName     string    `json:"product_name"`
	ProductImageURL *string   `json:"product_image_url"`
	Quantity        int       `json:"quantity"`
	UnitPrice       float64   `json:"unit_price"`
	TotalPrice      float64   `json:"total_price"`
}

// ─── Create Order ─────────────────────────────────────────────────────────────

type CreateOrderRequest struct {
	CustomerID      uuid.UUID          `json:"customer_id"      validate:"required"`
	OrderType       OrderType          `json:"order_type"       validate:"required"`
	CityID          uuid.UUID          `json:"city_id"          validate:"required"` // delivery city (must be active)
	Items           []OrderItemRequest `json:"items"            validate:"required,min=1,dive"`
	Notes           *string            `json:"notes"`
	DeliveryAddress *string            `json:"delivery_address"`
	DeliveryMethod  string             `json:"delivery_method"` // "normal" | "fast" ("express" accepted as legacy alias); defaults to "normal"

	// Dispatcher-only: create order on behalf of a specific seller.
	SellerID *uuid.UUID `json:"seller_id"`
	// Dispatcher-only: override the initial status (e.g. "confirmed" to skip confirmation step).
	ForceStatus *string `json:"force_status"`

	// Prepayment verification fields (Migration 00040)
	PrepaymentRequired bool    `json:"prepayment_required"`
	PrepaymentType     *string `json:"prepayment_type"` // "partial" | "full" — computed automatically by service
	PrepaymentAmount   float64 `json:"prepayment_amount"`
	PrepaymentReceiver *string `json:"prepayment_receiver"` // "dispatcher_card" | "company_card" | "cash" | "other"
	PrepaymentComment  *string `json:"prepayment_comment"`
	// Attachment URLs — client uploads file first via /upload, then passes URL here.
	PaymentProofURL *string `json:"payment_proof_url"`
	CustomerChatURL *string `json:"customer_chat_url"`
}

// ─── Order Stats (dashboard order-health) ───────────────────────────────────────

// OrderStatsResponse is the order-health breakdown for the owner dashboard.
//   - ByStatus: count per order status in the period
//   - Unassigned: confirmed orders with no active courier assignment
//   - Scheduled: orders with a future scheduled_at (deferred / later)
//   - Total: all non-deleted orders in the period
type OrderStatsResponse struct {
	ByStatus   map[string]int `json:"by_status"`
	Unassigned int            `json:"unassigned"`
	Scheduled  int            `json:"scheduled"`
	Total      int            `json:"total"`
}

// ─── Update Order ─────────────────────────────────────────────────────────────

type UpdateOrderRequest struct {
	Notes              *string            `json:"notes"`
	DeliveryAddress    *string            `json:"delivery_address"`
	DeliveryMethod     *string            `json:"delivery_method"` // "normal" | "fast"
	CustomerName       *string            `json:"customer_name"`
	CustomerPhone      *string            `json:"customer_phone"`
	Items              []OrderItemRequest `json:"items"` // nil=no change; must have ≥1 if non-nil
	PrepaymentRequired *bool              `json:"prepayment_required"`
	PrepaymentAmount   *float64           `json:"prepayment_amount"`
	PrepaymentReceiver *string            `json:"prepayment_receiver"`
	PrepaymentComment  *string            `json:"prepayment_comment"`
	PaymentProofURL    *string            `json:"payment_proof_url"`
	CustomerChatURL    *string            `json:"customer_chat_url"`
}

// ─── Order Comments ────────────────────────────────────────────────────────────

type AddOrderCommentRequest struct {
	Comment string `json:"comment" validate:"required,min=1,max=2000"`
}

type OrderCommentResponse struct {
	ID         uuid.UUID `json:"id"`
	OrderID    uuid.UUID `json:"order_id"`
	UserID     uuid.UUID `json:"user_id"`
	AuthorName string    `json:"author_name"`
	AuthorRole string    `json:"author_role"`
	Comment    string    `json:"comment"`
	Text       string    `json:"text"`
	Visibility string    `json:"visibility"`
	CreatedAt  time.Time `json:"created_at"`
}

// ─── Status Change ────────────────────────────────────────────────────────────

type ChangeStatusRequest struct {
	Status  OrderStatus `json:"status"  validate:"required"`
	Comment *string     `json:"comment"`
}

// ─── Prepayment Verification ──────────────────────────────────────────────────

type VerifyPrepaymentRequest struct {
	Comment *string `json:"comment"`
}

type RejectPrepaymentRequest struct {
	Reason string `json:"reason" validate:"required"`
}

type AttachmentResponse struct {
	ID         uuid.UUID `json:"id"`
	OrderID    uuid.UUID `json:"order_id"`
	Type       string    `json:"type"`
	FileURL    string    `json:"file_url"`
	UploadedBy uuid.UUID `json:"uploaded_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// ─── Prepayment ───────────────────────────────────────────────────────────────

type AddPrepaymentRequest struct {
	Amount   float64 `json:"amount"    validate:"required,min=0.01"`
	ProofURL *string `json:"proof_url"`
}

type PrepaymentResponse struct {
	ID         uuid.UUID  `json:"id"`
	OrderID    uuid.UUID  `json:"order_id"`
	Amount     float64    `json:"amount"`
	ProofURL   *string    `json:"proof_url"`
	VerifiedBy *uuid.UUID `json:"verified_by"`
	VerifiedAt *time.Time `json:"verified_at"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

func ToPrepaymentResponse(p *OrderPrepayment) PrepaymentResponse {
	return PrepaymentResponse{
		ID:         p.ID,
		OrderID:    p.OrderID,
		Amount:     p.Amount,
		ProofURL:   p.ProofURL,
		VerifiedBy: p.VerifiedBy,
		VerifiedAt: p.VerifiedAt,
		CreatedBy:  p.CreatedBy,
		CreatedAt:  p.CreatedAt,
	}
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

type TimelineResponse struct {
	ID         uuid.UUID    `json:"id"`
	OrderID    uuid.UUID    `json:"order_id"`
	FromStatus *OrderStatus `json:"from_status"`
	ToStatus   OrderStatus  `json:"to_status"`
	Comment    *string      `json:"comment"`
	CreatedBy  uuid.UUID    `json:"created_by"`
	ActorName  string       `json:"actor_name"`
	CreatedAt  time.Time    `json:"created_at"`
}

func ToTimelineResponse(t *OrderTimeline) TimelineResponse {
	return TimelineResponse{
		ID:         t.ID,
		OrderID:    t.OrderID,
		FromStatus: t.FromStatus,
		ToStatus:   t.ToStatus,
		Comment:    t.Comment,
		CreatedBy:  t.CreatedBy,
		ActorName:  t.ActorName,
		CreatedAt:  t.CreatedAt,
	}
}

// ─── Order Response ───────────────────────────────────────────────────────────

type CustomerResponse struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
	Phone    string    `json:"phone"`
	City     *string   `json:"city,omitempty"`
	Address  *string   `json:"address,omitempty"`
}

type SellerResponse struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
	Phone    string    `json:"phone"`
}

type OrderResponse struct {
	ID          uuid.UUID `json:"id"`
	OrderNumber string    `json:"order_number"`

	CustomerID uuid.UUID         `json:"customer_id"`
	Customer   *CustomerResponse `json:"customer,omitempty"`
	Seller     *SellerResponse   `json:"seller,omitempty"`
	SellerID   uuid.UUID         `json:"seller_id"`

	ManagerID      *uuid.UUID `json:"manager_id"`
	TeamLeadID     *uuid.UUID `json:"team_lead_id"`
	ManagerTeamID  *uuid.UUID `json:"manager_team_id"`
	TeamLeadTeamID *uuid.UUID `json:"team_lead_team_id"`

	OrderType      OrderType   `json:"order_type"`
	Status         OrderStatus `json:"status"`
	CityID         *uuid.UUID  `json:"city_id"`
	SnapshotID     *uuid.UUID  `json:"snapshot_id"`
	DeliveryMethod string      `json:"delivery_method"`

	Subtotal         float64 `json:"subtotal"`
	DeliveryFee      float64 `json:"delivery_fee"`
	CourierPayout    float64 `json:"courier_payout"`
	TotalAmount      float64 `json:"total_amount"`       // = subtotal (product total)
	TotalOrderAmount float64 `json:"total_order_amount"` // = total_amount + delivery_fee
	NetRevenue       float64 `json:"net_revenue"`
	PrepaymentAmount float64 `json:"prepayment_amount"`
	AmountToCollect  float64 `json:"amount_to_collect"` // = total_order_amount - prepayment_amount
	PaymentLabel     string  `json:"payment_label"`     // cod | partial_prepayment | full_prepayment

	// Prepayment verification
	PrepaymentRequired        bool       `json:"prepayment_required"`
	PrepaymentType            *string    `json:"prepayment_type"`
	PrepaymentStatus          string     `json:"prepayment_status"`
	PrepaymentReceiver        *string    `json:"prepayment_receiver"`
	PrepaymentComment         *string    `json:"prepayment_comment"`
	PrepaymentVerifiedBy      *uuid.UUID `json:"prepayment_verified_by"`
	PrepaymentVerifiedAt      *time.Time `json:"prepayment_verified_at"`
	PrepaymentRejectionReason *string    `json:"prepayment_rejection_reason"`

	Notes           *string              `json:"notes"`
	DeliveryAddress *string              `json:"delivery_address"`
	Items           []OrderItemResponse  `json:"items"`
	Attachments     []AttachmentResponse `json:"attachments"`
	CreatedAt       time.Time            `json:"created_at"`
	UpdatedAt       time.Time            `json:"updated_at"`

	// ── Courier display (resolved from assignment history, see CourierInfo) ──
	// current_*  = the courier actively holding the order (assigned/in_delivery).
	// delivered_by_* = the courier who delivered it (for delivered orders).
	// courier_display_* = the single value the UI should render, already resolved
	// per business rule so the frontend never has to fall back to orders.courier_id.
	//   courier_display_status ∈ "assigned" | "delivered_by" | "unassigned" | "former"
	CurrentCourierID       *uuid.UUID `json:"current_courier_id"`
	CurrentCourierName     *string    `json:"current_courier_name"`
	DeliveredByCourierID   *uuid.UUID `json:"delivered_by_courier_id"`
	DeliveredByCourierName *string    `json:"delivered_by_courier_name"`
	CourierDisplayName     *string    `json:"courier_display_name"`
	CourierDisplayStatus   string     `json:"courier_display_status"`
}

// CourierInfo carries the resolved courier identities for an order, sourced from
// order_assignments (active = is_active row; last = most recent assignment of any
// state, so a delivered order with an inactive assignment still resolves).
type CourierInfo struct {
	ActiveCourierID   *uuid.UUID
	ActiveCourierName *string
	LastCourierID     *uuid.UUID
	LastCourierName   *string
}

// applyCourierDisplay populates the courier_* response fields from resolved
// assignment info, following the business rule / data-source priority:
//
//  1. active assignment courier   (current holder)
//  2. last assignment courier     (delivered / inactive history)
//  3. orders.courier_id cache     (fallback when no assignment row resolved a name)
//  4. null
//
// Display rules by order status:
//   - delivered            → delivered_by = last courier, status "delivered_by"
//   - assigned/in_delivery/issue → current = active|last courier, status "assigned"
//   - returned/cancelled    → last courier (if any), status "former"
//   - new/confirmed/prepay  → active courier if present (defensive), else "unassigned"
func (r *OrderResponse) applyCourierDisplay(info CourierInfo, fallbackCourierID *uuid.UUID) {
	r.CourierDisplayStatus = "unassigned"

	// Current courier: prefer the active assignment.
	if info.ActiveCourierID != nil {
		r.CurrentCourierID = info.ActiveCourierID
		r.CurrentCourierName = info.ActiveCourierName
	}

	switch r.Status {
	case StatusDelivered:
		// The courier who delivered it: latest assignment, active or not.
		if info.LastCourierID != nil {
			r.DeliveredByCourierID = info.LastCourierID
			r.DeliveredByCourierName = info.LastCourierName
			r.CourierDisplayName = info.LastCourierName
			r.CourierDisplayStatus = "delivered_by"
		}

	case StatusAssigned, StatusInDelivery, StatusIssue:
		name := info.ActiveCourierName
		if name == nil {
			name = info.LastCourierName
			if r.CurrentCourierID == nil {
				r.CurrentCourierID = info.LastCourierID
			}
		}
		if name != nil {
			r.CourierDisplayName = name
			r.CourierDisplayStatus = "assigned"
		}

	case StatusReturned, StatusCancelled:
		if info.LastCourierName != nil {
			r.CourierDisplayName = info.LastCourierName
			r.CourierDisplayStatus = "former"
		}

	default: // new, confirmed, prepayment_*
		if info.ActiveCourierName != nil {
			r.CourierDisplayName = info.ActiveCourierName
			r.CourierDisplayStatus = "assigned"
		}
	}

	// Fallback: if no name resolved from assignments but the cache still points at
	// a courier (and the order is in a courier-holding/terminal-delivered state),
	// at least expose the id so the UI can resolve a name from its courier map.
	if r.CourierDisplayName == nil && fallbackCourierID != nil &&
		(r.Status == StatusDelivered || r.Status == StatusAssigned ||
			r.Status == StatusInDelivery || r.Status == StatusIssue) {
		if r.CurrentCourierID == nil {
			r.CurrentCourierID = fallbackCourierID
		}
		if r.Status == StatusDelivered && r.DeliveredByCourierID == nil {
			r.DeliveredByCourierID = fallbackCourierID
			r.CourierDisplayStatus = "delivered_by"
		} else {
			r.CourierDisplayStatus = "assigned"
		}
	}
}

// PaymentLabel derives a display label from the prepayment amounts.
func PaymentLabel(prepayment, totalOrderAmount float64) string {
	if prepayment <= 0 {
		return "cod"
	}
	if prepayment >= totalOrderAmount {
		return "full_prepayment"
	}
	return "partial_prepayment"
}

func ToOrderResponse(o *Order) OrderResponse {
	items := make([]OrderItemResponse, 0, len(o.Items))
	for _, it := range o.Items {
		items = append(items, OrderItemResponse{
			ID:              it.ID,
			ProductID:       it.ProductID,
			ProductName:     it.ProductName,
			ProductImageURL: it.ProductImageURL,
			Quantity:        it.Quantity,
			UnitPrice:       it.UnitPrice,
			TotalPrice:      it.TotalPrice,
		})
	}
	attachments := make([]AttachmentResponse, 0, len(o.Attachments))
	for _, a := range o.Attachments {
		attachments = append(attachments, AttachmentResponse{
			ID:         a.ID,
			OrderID:    a.OrderID,
			Type:       a.Type,
			FileURL:    a.FileURL,
			UploadedBy: a.UploadedBy,
			CreatedAt:  a.CreatedAt,
		})
	}
	totalOrderAmount := o.TotalAmount + o.DeliveryFee
	amountToCollect := totalOrderAmount - o.PrepaymentAmount
	if amountToCollect < 0 {
		amountToCollect = 0
	}

	var customerResp *CustomerResponse
	if o.Customer != nil {
		customerResp = &CustomerResponse{
			ID:       o.Customer.ID,
			FullName: o.Customer.FullName,
			Phone:    o.Customer.Phone,
			City:     o.Customer.City,
			Address:  o.Customer.Address,
		}
	}
	var sellerResp *SellerResponse
	if o.Seller != nil {
		sellerResp = &SellerResponse{
			ID:       o.Seller.ID,
			FullName: o.Seller.FullName,
			Phone:    o.Seller.Phone,
		}
	}

	return OrderResponse{
		ID:               o.ID,
		OrderNumber:      o.OrderNumber,
		CustomerID:       o.CustomerID,
		Customer:         customerResp,
		Seller:           sellerResp,
		SellerID:         o.SellerID,
		ManagerID:        o.ManagerID,
		TeamLeadID:       o.TeamLeadID,
		ManagerTeamID:    o.ManagerTeamID,
		TeamLeadTeamID:   o.TeamLeadTeamID,
		OrderType:        o.OrderType,
		Status:           o.Status,
		CityID:           o.CityID,
		SnapshotID:       o.SnapshotID,
		DeliveryMethod:   o.DeliveryMethod,
		Subtotal:         o.Subtotal,
		DeliveryFee:      o.DeliveryFee,
		CourierPayout:    o.CourierPayout,
		TotalAmount:      o.TotalAmount,
		TotalOrderAmount: totalOrderAmount,
		NetRevenue:       o.NetRevenue,
		PrepaymentAmount: o.PrepaymentAmount,
		AmountToCollect:  amountToCollect,
		PaymentLabel:     PaymentLabel(o.PrepaymentAmount, totalOrderAmount),

		PrepaymentRequired:        o.PrepaymentRequired,
		PrepaymentType:            o.PrepaymentType,
		PrepaymentStatus:          o.PrepaymentStatus,
		PrepaymentReceiver:        o.PrepaymentReceiver,
		PrepaymentComment:         o.PrepaymentComment,
		PrepaymentVerifiedBy:      o.PrepaymentVerifiedBy,
		PrepaymentVerifiedAt:      o.PrepaymentVerifiedAt,
		PrepaymentRejectionReason: o.PrepaymentRejectionReason,

		Notes:           o.Notes,
		DeliveryAddress: o.DeliveryAddress,
		Items:           items,
		Attachments:     attachments,
		CreatedAt:       o.CreatedAt,
		UpdatedAt:       o.UpdatedAt,
	}
}

// ─── Filter ───────────────────────────────────────────────────────────────────

type ListOrdersFilter struct {
	Status     string `form:"status"`
	SellerID   string `form:"seller_id"`
	ManagerID  string `form:"manager_id"`
	TeamLeadID string `form:"team_lead_id"`
	CustomerID string `form:"customer_id"`
	CourierID  string `form:"courier_id"`
	City       string `form:"city"`
	// Frontend sends "from" / "to" (YYYY-MM-DD). "date_from" / "date_to" accepted as aliases
	// to avoid breaking any direct API callers. Repository merges them: date_from wins if set.
	DateFrom  string `form:"date_from"`
	DateTo    string `form:"date_to"`
	From      string `form:"from"`
	To        string `form:"to"`
	OrderType string `form:"order_type"`
	NoCourier bool   `form:"no_courier"`
}
