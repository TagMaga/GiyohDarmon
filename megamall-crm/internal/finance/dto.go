package finance

// dto.go — Request/response DTOs for Phase 15 Owner Finance Dashboard.
//
// All response types use snake_case JSON tags.
// The three endpoints are:
//   GET /api/v1/finance/summary?from=&to=
//   GET /api/v1/finance/events?from=&to=&event_type=&page=&limit=
//   GET /api/v1/finance/cash?from=&to=&page=&limit=

import (
	"time"

	"github.com/google/uuid"
)

// ─── Query params ──────────────────────────────────────────────────────────────

// PeriodQueryParams is bound from query string by gin ShouldBindQuery.
// Both fields accept YYYY-MM-DD; empty means "use current-month default".
type PeriodQueryParams struct {
	From string `form:"from"`
	To   string `form:"to"`
}

// EventsQueryParams extends the period filter with an optional event_type.
type EventsQueryParams struct {
	From      string `form:"from"`
	To        string `form:"to"`
	EventType string `form:"event_type"`
}

// ─── Finance summary response ──────────────────────────────────────────────────

// FinanceSummaryResponse is returned by GET /finance/summary.
// All monetary values are in the local currency unit (two-decimal precision).
type FinanceSummaryResponse struct {
	Period  FinancePeriod       `json:"period"`
	Orders  FinanceOrdersSummary `json:"orders"`
	Revenue FinanceRevenueSummary `json:"revenue"`
	Cash    FinanceCashSummary  `json:"cash"`
}

// FinancePeriod echoes the effective date range used for the query.
// Frontend can use these to render "Report for 01.06 – 10.06".
type FinancePeriod struct {
	From string `json:"from"` // YYYY-MM-DD
	To   string `json:"to"`   // YYYY-MM-DD
}

// FinanceOrdersSummary covers order-level aggregates from the orders table.
// Only delivered orders are counted for monetary figures.
type FinanceOrdersSummary struct {
	TotalCount     int     `json:"total_count"`     // delivered orders in period
	DeliveredCount int     `json:"delivered_count"` // same as total_count (all delivered)
	TotalSales     float64 `json:"total_sales"`     // SUM(total_amount)
	DeliveryFees   float64 `json:"delivery_fees"`   // SUM(delivery_fee)
	NetRevenue     float64 `json:"net_revenue"`     // SUM(net_revenue)
}

// FinanceRevenueSummary covers financial_events aggregates grouped by event_type.
// Orphan events (order_id IS NULL) are excluded.
type FinanceRevenueSummary struct {
	CompanyRevenueEarned              float64 `json:"company_revenue_earned"`
	SellerCommissionEarned            float64 `json:"seller_commission_earned"`
	ManagerPersonalCommissionEarned   float64 `json:"manager_personal_commission_earned"`
	ManagerTeamCommissionEarned       float64 `json:"manager_team_commission_earned"`
	TeamLeadPoolEarned                float64 `json:"team_lead_pool_earned"`
	TotalEmployeePayouts              float64 `json:"total_employee_payouts"`
	// CourierPayouts is the company expense paid to couriers (courier_fee_earned),
	// independent of client delivery fees. Company net profit ≈
	// company_revenue_earned − courier_payouts (− fixed expenses).
	CourierPayouts                    float64 `json:"courier_payouts"`
}

// FinanceCashSummary covers cash_handovers aggregates.
// cash_outstanding = cash_collected − cash_returned (still held by couriers).
type FinanceCashSummary struct {
	HandoversConfirmed int     `json:"handovers_confirmed"`
	HandoversPending   int     `json:"handovers_pending"`
	CashCollected      float64 `json:"cash_collected"`  // SUM(total_collected) confirmed
	CashReturned       float64 `json:"cash_returned"`   // SUM(actual_returned)  confirmed
	CashOutstanding    float64 `json:"cash_outstanding"` // collected − returned
}

// ─── Finance events response ───────────────────────────────────────────────────

// FinanceEventResponse is a single financial event row for GET /finance/events.
// Includes company_revenue_earned rows (user_id = NULL).
type FinanceEventResponse struct {
	ID        uuid.UUID  `json:"id"`
	OrderID   *uuid.UUID `json:"order_id"`
	UserID    *uuid.UUID `json:"user_id"`
	EventType string     `json:"event_type"`
	Amount    float64    `json:"amount"`
	CreatedAt time.Time  `json:"created_at"`
}

// ─── Finance cash response ─────────────────────────────────────────────────────

// FinanceCashHandoverResponse is a single handover row for GET /finance/cash.
type FinanceCashHandoverResponse struct {
	ID                uuid.UUID  `json:"id"`
	CourierID         uuid.UUID  `json:"courier_id"`
	DispatcherID      *uuid.UUID `json:"dispatcher_id"`
	TotalCollected    float64    `json:"total_collected"`
	TotalDeliveryFees float64    `json:"total_delivery_fees"`
	TotalToReturn     float64    `json:"total_to_return"`
	ActualReturned    *float64   `json:"actual_returned"`
	Status            string     `json:"status"`
	ProofURL          *string    `json:"proof_url"`
	Comment           *string    `json:"comment"`
	ConfirmedAt       *time.Time `json:"confirmed_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

// ─── Internal scan rows (never serialised) ────────────────────────────────────

// ordersSummaryRow is scanned from the orders aggregate query.
type ordersSummaryRow struct {
	TotalCount     int     `gorm:"column:total_count"`
	TotalSales     float64 `gorm:"column:total_sales"`
	DeliveryFees   float64 `gorm:"column:delivery_fees"`
	NetRevenue     float64 `gorm:"column:net_revenue"`
}

// eventAggRow is scanned from the financial_events GROUP BY event_type query.
type eventAggRow struct {
	EventType string  `gorm:"column:event_type"`
	Total     float64 `gorm:"column:total"`
}

// cashSummaryRow is scanned from the cash_handovers aggregate query.
type cashSummaryRow struct {
	ConfirmedCount int     `gorm:"column:confirmed_count"`
	PendingCount   int     `gorm:"column:pending_count"`
	CashCollected  float64 `gorm:"column:cash_collected"`
	CashReturned   float64 `gorm:"column:cash_returned"`
}

// handoverRow is scanned for paginated cash handover rows.
type handoverRow struct {
	ID                uuid.UUID  `gorm:"column:id"`
	CourierID         uuid.UUID  `gorm:"column:courier_id"`
	DispatcherID      *uuid.UUID `gorm:"column:dispatcher_id"`
	TotalCollected    float64    `gorm:"column:total_collected"`
	TotalDeliveryFees float64    `gorm:"column:total_delivery_fees"`
	TotalToReturn     float64    `gorm:"column:total_to_return"`
	ActualReturned    *float64   `gorm:"column:actual_returned"`
	Status            string     `gorm:"column:status"`
	ProofURL          *string    `gorm:"column:proof_url"`
	Comment           *string    `gorm:"column:comment"`
	ConfirmedAt       *time.Time `gorm:"column:confirmed_at"`
	CreatedAt         time.Time  `gorm:"column:created_at"`
}

// ─── Daily trend (Phase 5D) ───────────────────────────────────────────────────

// DailyPoint is one day's worth of revenue data for GET /finance/daily.
type DailyPoint struct {
	Date           string  `json:"date"`            // YYYY-MM-DD
	OrdersCount    int     `json:"orders_count"`
	TotalSales     float64 `json:"total_sales"`     // SUM(total_amount) of delivered orders
	DeliveryFees   float64 `json:"delivery_fees"`   // SUM(delivery_fee)
	CompanyRevenue float64 `json:"company_revenue"` // company_revenue_earned events
}

// dailyRow is the internal GORM scan target for GetDailyRevenue.
type dailyRow struct {
	Date           string  `gorm:"column:date"`
	OrdersCount    int     `gorm:"column:orders_count"`
	TotalSales     float64 `gorm:"column:total_sales"`
	DeliveryFees   float64 `gorm:"column:delivery_fees"`
	CompanyRevenue float64 `gorm:"column:company_revenue"`
}

// ─── Seller leaderboard (Phase 5D) ───────────────────────────────────────────

// SellerPerformanceRow is one seller's aggregated stats for GET /finance/sellers.
type SellerPerformanceRow struct {
	Rank            int       `json:"rank"`
	SellerID        uuid.UUID `json:"seller_id"`
	FullName        string    `json:"full_name"`
	OrdersCount     int       `json:"orders_count"`    // delivered in period
	TotalRevenue    float64   `json:"total_revenue"`   // SUM(total_amount) delivered
	TotalCommission float64   `json:"total_commission"`// seller_commission_earned events
}

// sellerPerfRow is the internal GORM scan target for GetSellerPerformance.
type sellerPerfRow struct {
	SellerID        uuid.UUID `gorm:"column:seller_id"`
	FullName        string    `gorm:"column:full_name"`
	OrdersCount     int       `gorm:"column:orders_count"`
	TotalRevenue    float64   `gorm:"column:total_revenue"`
	TotalCommission float64   `gorm:"column:total_commission"`
}

// ─── Team performance (Phase 5D) ─────────────────────────────────────────────

// TeamPerformanceRow is one team's aggregated stats for GET /finance/teams.
type TeamPerformanceRow struct {
	TeamLeadID     uuid.UUID `json:"team_lead_id"`
	TeamName       string    `json:"team_name"`       // from teams.name (may be empty string)
	TeamLeadName   string    `json:"team_lead_name"`  // from users.full_name
	OrdersCount    int       `json:"orders_count"`
	TotalRevenue   float64   `json:"total_revenue"`
	CompanyRevenue float64   `json:"company_revenue"`
}

// teamPerfRow is the internal GORM scan target for GetTeamPerformance.
type teamPerfRow struct {
	TeamLeadID     uuid.UUID `gorm:"column:team_lead_id"`
	TeamName       string    `gorm:"column:team_name"`
	TeamLeadName   string    `gorm:"column:team_lead_name"`
	OrdersCount    int       `gorm:"column:orders_count"`
	TotalRevenue   float64   `gorm:"column:total_revenue"`
	CompanyRevenue float64   `gorm:"column:company_revenue"`
}

// LimitQueryParams adds an optional limit param on top of PeriodQueryParams.
type LimitQueryParams struct {
	From  string `form:"from"`
	To    string `form:"to"`
	Limit int    `form:"limit"`
}
