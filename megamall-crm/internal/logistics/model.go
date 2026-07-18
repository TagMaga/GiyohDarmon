package logistics

import (
	"time"

	"github.com/google/uuid"
)

// ─── Courier display status (computed, not stored) ────────────────────────────

type CourierDisplayStatus string

const (
	CourierDisplayFree     CourierDisplayStatus = "free"
	CourierDisplayBusy     CourierDisplayStatus = "busy"
	CourierDisplayInactive CourierDisplayStatus = "inactive"
)

// ─── Dashboard ───────────────────────────────────────────────────────────────

type DashboardResponse struct {
	ActiveCouriers       int          `json:"active_couriers"`
	BusyCouriers         int          `json:"busy_couriers"`
	FreeCouriers         int          `json:"free_couriers"`
	OrdersAssignedToday  int          `json:"orders_assigned_today"`
	CashExpected         float64      `json:"cash_expected"`
	CashInCirculation    float64      `json:"cash_in_circulation"`
	CashHandedOverToday  float64      `json:"cash_handed_over_today"`
	CashHandedOverWeek   float64      `json:"cash_handed_over_week"`
	OverdueDeliveries    int          `json:"overdue_deliveries"`
	FailedToday          int          `json:"failed_today"`
	SuccessRate          float64      `json:"success_rate"`
	AvgDeliveryMinutes   float64      `json:"avg_delivery_minutes"`
	OrdersWithoutCourier int          `json:"orders_without_courier"`
	AtRiskDeliveries     int          `json:"at_risk_deliveries"`
	TopCouriers          []TopCourier `json:"top_couriers"`
	BestSuccessCourier   *TopCourier  `json:"best_success_courier"`
	BiggestDebtCourier   *TopCourier  `json:"biggest_debt_courier"`
}

type TopCourier struct {
	CourierID      uuid.UUID `json:"courier_id"`
	FullName       string    `json:"full_name"`
	DeliveredCount int       `json:"delivered_count"`
	SuccessRate    float64   `json:"success_rate"`
	CashDebt       float64   `json:"cash_debt"`
}

// ─── Courier list ─────────────────────────────────────────────────────────────

type CourierListRow struct {
	CourierID          uuid.UUID            `json:"courier_id"`
	FullName           string               `json:"full_name"`
	Phone              string               `json:"phone"`
	TelegramChatID     *string              `json:"telegram_chat_id,omitempty"`
	IsActive           bool                 `json:"is_active"`
	OrderIntakeEnabled bool                 `json:"order_intake_enabled"`
	OrderIntakeReason  *string              `json:"order_intake_reason,omitempty"`
	Status             CourierDisplayStatus `json:"status"`
	ActiveOrders       int                  `json:"active_orders"`
	OrdersToday        int                  `json:"orders_today"`
	DeliveredToday     int                  `json:"delivered_today"`
	FailedToday        int                  `json:"failed_today"`
	SuccessRate        float64              `json:"success_rate"`
	AvgDeliveryMinutes float64              `json:"avg_delivery_minutes"`
	CashDebt           float64              `json:"cash_debt"`
	Earnings           float64              `json:"earnings"`
	LastActivityAt     *time.Time           `json:"last_activity_at"`
	CityIDs            []uuid.UUID          `json:"city_ids"`
}

// ─── Courier detail ──────────────────────────────────────────────────────────

type CourierDetailResponse struct {
	CourierID          uuid.UUID            `json:"courier_id"`
	FullName           string               `json:"full_name"`
	Phone              string               `json:"phone"`
	IsActive           bool                 `json:"is_active"`
	Status             CourierDisplayStatus `json:"status"`
	TotalDelivered     int                  `json:"total_delivered"`
	TotalFailed        int                  `json:"total_failed"`
	SuccessRate        float64              `json:"success_rate"`
	AvgDeliveryMinutes float64              `json:"avg_delivery_minutes"`
	CashDebt           float64              `json:"cash_debt"`
	TotalHandedOver    float64              `json:"total_handed_over"`
	Earnings           float64              `json:"earnings"`
	ActiveOrders       int                  `json:"active_orders"`
}

// ─── Courier orders ───────────────────────────────────────────────────────────

type CourierOrderRow struct {
	OrderID          uuid.UUID  `json:"order_id"`
	OrderNumber      string     `json:"order_number"`
	CustomerName     string     `json:"customer_name"`
	CustomerPhone    *string    `json:"customer_phone"`
	DeliveryAddress  *string    `json:"delivery_address"`
	TotalAmount      float64    `json:"total_amount"`
	DeliveryFee      float64    `json:"delivery_fee"`
	PrepaymentAmount float64    `json:"prepayment_amount"`
	Status           string     `json:"status"`
	AssignedAt       *time.Time `json:"assigned_at"`
	DeliveredAt      *time.Time `json:"delivered_at"`
	DeliveryMinutes  *float64   `json:"delivery_minutes"`
	Notes            *string    `json:"notes"`
	CreatedAt        time.Time  `json:"created_at"`
}

// ─── Courier performance ──────────────────────────────────────────────────────

type PerformancePoint struct {
	Date               string  `json:"date"`
	Delivered          int     `json:"delivered"`
	Failed             int     `json:"failed"`
	CashCollected      float64 `json:"cash_collected"`
	AvgDeliveryMinutes float64 `json:"avg_delivery_minutes"`
}

// ─── Cash handovers ───────────────────────────────────────────────────────────

type HandoverListRow struct {
	ID                uuid.UUID  `json:"id"`
	CourierID         uuid.UUID  `json:"courier_id"`
	CourierName       string     `json:"courier_name"`
	CourierPhone      string     `json:"courier_phone"`
	TotalCollected    float64    `json:"total_collected"`
	TotalDeliveryFees float64    `json:"total_delivery_fees"`
	TotalToReturn     float64    `json:"total_to_return"`
	ActualReturned    *float64   `json:"actual_returned"`
	Status            string     `json:"status"`
	ProofURL          *string    `json:"proof_url"`
	AttachmentsJSON   *string    `json:"attachments_json"`
	Comment           *string    `json:"comment"`
	AdminNote         *string    `json:"admin_note"`
	ConfirmedAt       *time.Time `json:"confirmed_at"`
	CreatedAt         time.Time  `json:"created_at"`
	// MediaAssets is resolved fresh (signed URLs, never persisted) by
	// Handler.listHandovers via the adapters set through SetMediaAdapters —
	// mirrors internal/courier.Service.ToHandoverResponse's
	// HandoverResponse.MediaAssets exactly, for the same underlying
	// cash_handovers rows viewed here from the owner's logistics dashboard
	// instead of the courier/dispatcher endpoints. Left nil (omitted) when
	// the media pipeline is disabled or the adapters haven't been set.
	MediaAssets []HandoverMediaAsset `json:"media_assets,omitempty"`
}

// HandoverMediaAsset is one resolved cash-handover proof image — same
// shape as internal/courier.HandoverMediaAsset.
type HandoverMediaAsset struct {
	ID     uuid.UUID `json:"id"`
	URL    string    `json:"url"`
	Width  *int      `json:"width,omitempty"`
	Height *int      `json:"height,omitempty"`
}

// Amount bounds (max=1000000) are a fat-finger/overflow guard on
// cash-in-hand, not a real business ceiling — mirrors the same bound used
// for courier/dispatch handover amounts (internal/courier/dto.go,
// internal/dispatch/dto.go).
type CreateHandoverReq struct {
	CourierID         uuid.UUID `json:"courier_id"          validate:"required"`
	TotalCollected    float64   `json:"total_collected"     validate:"min=0,max=1000000"`
	TotalDeliveryFees float64   `json:"total_delivery_fees" validate:"min=0,max=1000000"`
	TotalToReturn     float64   `json:"total_to_return"     validate:"min=0,max=1000000"`
	Comment           *string   `json:"comment"`
}

type UpdateHandoverReq struct {
	Status         *string  `json:"status" validate:"omitempty,oneof=pending confirmed rejected disputed"`
	ActualReturned *float64 `json:"actual_returned" validate:"omitempty,min=0,max=1000000"`
	Comment        *string  `json:"comment"`
	AdminNote      *string  `json:"admin_note"`
}
