package compensation

// income_dto.go — DTOs and filter types for Phase 14 income reporting.
//
// Separation from dto.go keeps commission-config DTOs distinct from income
// reporting DTOs so each evolves independently.

import (
	"time"

	"github.com/google/uuid"
)

// ─── Event filter (used by income + extended events list) ─────────────────────

// FinancialEventFilter is passed to all income / event-list repository methods.
// All fields are optional — zero values are ignored.
type FinancialEventFilter struct {
	OrderID   *uuid.UUID
	UserID    *uuid.UUID
	EventType FinancialEventType // "" = no filter
	From      *time.Time
	To        *time.Time
	// IncludeCompany: when true the query also returns company_revenue_earned events.
	// Defaults to false so personal income never includes company events.
	IncludeCompany bool
}

// ─── Income query params (bound from HTTP query string) ───────────────────────

// IncomeQueryParams is bound by gin ShouldBindQuery for /hr/income/* handlers.
type IncomeQueryParams struct {
	From          string `form:"from"`           // "YYYY-MM-DD" — default: start of current month
	To            string `form:"to"`             // "YYYY-MM-DD" — default: today
	EventType     string `form:"event_type"`     // optional single-type filter
	IncludeEvents bool   `form:"include_events"` // default false
}

// ─── Internal scan types (returned from raw SQL, never serialised directly) ───

// incomeAggRow is scanned from the GROUP BY aggregation query in GetIncomeSummary.
type incomeAggRow struct {
	EventType   string  `gorm:"column:event_type"`
	Total       float64 `gorm:"column:total"`
	OrdersCount int     `gorm:"column:orders_count"`
}

// incomeTotalRow is scanned from the overall-totals query.
type incomeTotalRow struct {
	TotalIncome float64 `gorm:"column:total_income"`
	OrdersCount int     `gorm:"column:orders_count"`
}

type incomeOrderTotalsRow struct {
	TotalRevenue       float64 `gorm:"column:total_revenue"`
	TotalDeliveryFee   float64 `gorm:"column:total_delivery_fee"`
	TotalNetRevenue    float64 `gorm:"column:total_net_revenue"`
	TotalCourierPayout float64 `gorm:"column:total_courier_payout"`
}

// incomeEventRow is scanned from the enriched events query (JOIN orders).
type incomeEventRow struct {
	ID            uuid.UUID          `gorm:"column:id"`
	OrderID       *uuid.UUID         `gorm:"column:order_id"`
	EventType     FinancialEventType `gorm:"column:event_type"`
	Amount        float64            `gorm:"column:amount"`
	CreatedAt     time.Time          `gorm:"column:created_at"`
	OrderNumber   string             `gorm:"column:order_number"`
	OrderType     string             `gorm:"column:order_type"`
	NetRevenue    float64            `gorm:"column:net_revenue"`
	TotalAmount   float64            `gorm:"column:total_amount"`
	DeliveryFee   float64            `gorm:"column:delivery_fee"`
	CourierPayout float64            `gorm:"column:courier_payout"`
}

// teamMemberIncomeRow is scanned for the per-member team income breakdown.
type teamMemberIncomeRow struct {
	UserID      uuid.UUID `gorm:"column:user_id"`
	EventType   string    `gorm:"column:event_type"`
	Total       float64   `gorm:"column:total"`
	OrdersCount int       `gorm:"column:orders_count"`
}

// ─── Income response DTOs (serialised as snake_case JSON) ─────────────────────

// IncomeByType maps FinancialEventType string → total amount earned in the period.
type IncomeByType map[string]float64

// IncomeEventResponse is one enriched event row inside the income report's events list.
type IncomeEventResponse struct {
	ID          uuid.UUID          `json:"id"`
	OrderID     *uuid.UUID         `json:"order_id"`
	EventType   FinancialEventType `json:"event_type"`
	Amount      float64            `json:"amount"`
	CreatedAt   time.Time          `json:"created_at"`
	OrderNumber string             `json:"order_number,omitempty"`
	OrderType   string             `json:"order_type,omitempty"`
	NetRevenue  float64            `json:"net_revenue,omitempty"`
	TotalAmount float64            `json:"total_amount,omitempty"`
	DeliveryFee float64            `json:"delivery_fee,omitempty"`
	// CourierPayout is what MegaMall actually pays the courier for this order —
	// the amount the commission math subtracts before applying the seller's
	// rate (internal/orders/financial.go), as opposed to DeliveryFee (what the
	// client was charged), which can differ or be unset.
	CourierPayout float64 `json:"courier_payout,omitempty"`
}

// IncomeReportResponse is returned by GET /hr/income/me and GET /hr/income/users/:id.
//
// orders_count == delivered_count because only delivered orders emit financial events.
type IncomeReportResponse struct {
	UserID           uuid.UUID `json:"user_id"`
	PeriodStart      time.Time `json:"period_start"`
	PeriodEnd        time.Time `json:"period_end"`
	TotalIncome      float64   `json:"total_income"`
	TotalRevenue     float64   `json:"total_revenue"`
	TotalDeliveryFee float64   `json:"total_delivery_fee"`
	// TotalCourierPayout sums orders.courier_payout (what MegaMall pays the
	// courier — the real per-order commission deduction), as opposed to
	// TotalDeliveryFee (what the client was charged), which can differ or be unset.
	TotalCourierPayout float64               `json:"total_courier_payout"`
	NetProfit          float64               `json:"net_profit"`
	OrdersCount        int                   `json:"orders_count"`
	DeliveredCount     int                   `json:"delivered_count"`
	AveragePerOrder    float64               `json:"average_per_order"`
	ByEventType        IncomeByType          `json:"by_event_type"`
	Events             []IncomeEventResponse `json:"events,omitempty"`
}

// TeamMemberIncome is one member's income inside a TeamIncomeResponse.
type TeamMemberIncome struct {
	UserID      uuid.UUID    `json:"user_id"`
	TotalIncome float64      `json:"total_income"`
	OrdersCount int          `json:"orders_count"`
	ByEventType IncomeByType `json:"by_event_type"`
}

// TeamIncomeResponse is returned by GET /hr/income/teams/:id.
// :id is the team lead's user_id (income is grouped by team_lead_id in orders).
type TeamIncomeResponse struct {
	TeamLeadID  uuid.UUID          `json:"team_lead_id"`
	PeriodStart time.Time          `json:"period_start"`
	PeriodEnd   time.Time          `json:"period_end"`
	TotalIncome float64            `json:"total_income"`
	OrdersCount int                `json:"orders_count"`
	ByEventType IncomeByType       `json:"by_event_type"`
	Members     []TeamMemberIncome `json:"members"`
}

// EventListResponse is the snake_case DTO for the extended GET /hr/events response.
// Replaces the bare FinancialEvent struct (which lacked json tags → PascalCase output).
//
// Phase 25: OrderID changed from *uuid.UUID to uuid.UUID — financial events now
// always have an order_id (NOT NULL constraint added in migration 00036).
type EventListResponse struct {
	ID         uuid.UUID          `json:"id"`
	OrderID    uuid.UUID          `json:"order_id"` // Phase 25: always set — NOT NULL
	SnapshotID *uuid.UUID         `json:"snapshot_id"`
	EventType  FinancialEventType `json:"event_type"`
	UserID     *uuid.UUID         `json:"user_id"`
	Amount     float64            `json:"amount"`
	CreatedAt  time.Time          `json:"created_at"`
}

// toEventListResponse converts a FinancialEvent domain model to its API DTO.
func toEventListResponse(e FinancialEvent) EventListResponse {
	return EventListResponse{
		ID:         e.ID,
		OrderID:    e.OrderID,
		SnapshotID: e.SnapshotID,
		EventType:  e.EventType,
		UserID:     e.UserID,
		Amount:     e.Amount,
		CreatedAt:  e.CreatedAt,
	}
}
