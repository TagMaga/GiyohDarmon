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

// EventsQueryParams extends the period filter with optional ledger filters.
type EventsQueryParams struct {
	From      string   `form:"from"`
	To        string   `form:"to"`
	EventType string   `form:"event_type"`
	OrderID   string   `form:"order_id"` // raw string; parsed to *uuid.UUID in handler
	UserID    string   `form:"user_id"`  // raw string; parsed to *uuid.UUID in handler
	MinAmount *float64 `form:"min_amount"`
	MaxAmount *float64 `form:"max_amount"`
}

// ─── Finance summary response ──────────────────────────────────────────────────

// FinanceSummaryResponse is returned by GET /finance/summary.
// All monetary values are in the local currency unit (two-decimal precision).
type FinanceSummaryResponse struct {
	Period   FinancePeriod          `json:"period"`
	Orders   FinanceOrdersSummary   `json:"orders"`
	Revenue  FinanceRevenueSummary  `json:"revenue"`
	Expenses FinanceExpensesSummary `json:"expenses"`
	Cash     FinanceCashSummary     `json:"cash"`
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
	TotalCount         int     `json:"total_count"`          // delivered orders in period
	DeliveredCount     int     `json:"delivered_count"`      // same as total_count (all delivered)
	TotalSales         float64 `json:"total_sales"`          // SUM(total_amount); product price only, client delivery fee NOT included
	CourierPayout      float64 `json:"courier_payout"`       // SUM(courier_payout) paid to couriers (company cost)
	ClientDeliveryFees float64 `json:"client_delivery_fees"` // SUM(delivery_fee) charged to clients — informational, not part of any formula below
	NetRevenue         float64 `json:"net_revenue"`          // total_sales + client_delivery_fees - courier_payout
	ProductCost        float64 `json:"product_cost"`         // SUM(batch_consumption.quantity * batch_consumption.unit_cost) — actual FIFO cost
	CommissionBase     float64 `json:"commission_base"`      // total_sales - courier_payout
	TeamPayouts        float64 `json:"team_payouts"`         // sum of seller/manager/team-lead-pool financial_events (= commission_base × 40% under default rates)
	CompanyGross       float64 `json:"company_gross"`        // company_revenue_earned financial_events (= commission_base × 60% under default rates)
}

// FinanceRevenueSummary covers financial_events aggregates grouped by event_type.
// Orphan events (order_id IS NULL) are excluded.
type FinanceRevenueSummary struct {
	CompanyRevenueEarned            float64 `json:"company_revenue_earned"`
	SellerCommissionEarned          float64 `json:"seller_commission_earned"`
	ManagerPersonalCommissionEarned float64 `json:"manager_personal_commission_earned"`
	ManagerTeamCommissionEarned     float64 `json:"manager_team_commission_earned"`
	TeamLeadPoolEarned              float64 `json:"team_lead_pool_earned"`
	TotalEmployeePayouts            float64 `json:"total_employee_payouts"`
	// CourierPayouts is the delivery salary earned by couriers (courier_fee_earned).
	// In cash handovers this amount is kept by the courier from collected cash.
	CourierPayouts float64 `json:"courier_payouts"`
}

// FinanceExpensesSummary covers business expenses in the period, by category,
// plus the resulting net profit.
type FinanceExpensesSummary struct {
	Salaries              float64 `json:"salaries"`
	Rent                  float64 `json:"rent"`
	Marketing             float64 `json:"marketing"`
	Taxes                 float64 `json:"taxes"`
	OtherBusinessExpenses float64 `json:"other_business_expenses"`
	TotalBusinessExpenses float64 `json:"total_business_expenses"`
	NetProfit             float64 `json:"net_profit"` // company_gross - product_cost - total_business_expenses
}

// FinanceCashSummary covers cash_handovers aggregates.
// cash_outstanding = cash_collected − cash_returned (still held by couriers).
type FinanceCashSummary struct {
	HandoversConfirmed int     `json:"handovers_confirmed"`
	HandoversPending   int     `json:"handovers_pending"`
	CashCollected      float64 `json:"cash_collected"`      // SUM(total_collected) confirmed
	CashReturned       float64 `json:"cash_returned"`       // SUM(actual_returned)  confirmed
	CourierPayoutKept  float64 `json:"courier_payout_kept"` // courier salary kept from cash
	CashOutstanding    float64 `json:"cash_outstanding"`    // collected − returned − courier_payout_kept
}

// ─── Finance events response ───────────────────────────────────────────────────

// FinanceEventResponse is a single financial event row for GET /finance/events.
// Includes company_revenue_earned rows (user_id = NULL).
type FinanceEventResponse struct {
	ID              uuid.UUID  `json:"id"`
	OrderID         *uuid.UUID `json:"order_id"`
	UserID          *uuid.UUID `json:"user_id"`
	EventType       string     `json:"event_type"`
	Amount          float64    `json:"amount"`
	Note            *string    `json:"note,omitempty"`
	ExpenseCategory *string    `json:"expense_category,omitempty"`
	IsEdited        bool       `json:"is_edited"`
	EditCount       int        `json:"edit_count"`
	LastEditedAt    *time.Time `json:"last_edited_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
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
	TotalCount         int     `gorm:"column:total_count"`
	TotalSales         float64 `gorm:"column:total_sales"`
	DeliveryFees       float64 `gorm:"column:delivery_fees"`
	ClientDeliveryFees float64 `gorm:"column:client_delivery_fees"`
	NetRevenue         float64 `gorm:"column:net_revenue"`
	ProductCost        float64 `gorm:"column:product_cost"`
}

// eventAggRow is scanned from the financial_events GROUP BY event_type query.
type eventAggRow struct {
	EventType string  `gorm:"column:event_type"`
	Total     float64 `gorm:"column:total"`
}

// cashSummaryRow is scanned from the cash_handovers aggregate query.
type cashSummaryRow struct {
	ConfirmedCount    int     `gorm:"column:confirmed_count"`
	PendingCount      int     `gorm:"column:pending_count"`
	CashCollected     float64 `gorm:"column:cash_collected"`
	CashReturned      float64 `gorm:"column:cash_returned"`
	CourierPayoutKept float64 `gorm:"column:courier_payout_kept"`
}

type expensesSummaryRow struct {
	Salaries              float64 `gorm:"column:salaries"`
	Rent                  float64 `gorm:"column:rent"`
	Marketing             float64 `gorm:"column:marketing"`
	Taxes                 float64 `gorm:"column:taxes"`
	OtherBusinessExpenses float64 `gorm:"column:other_business_expenses"`
}

// ─── Business expenses request/response ───────────────────────────────────────

// ExpenseRequest is the request body for POST/PATCH /finance/expenses.
type ExpenseRequest struct {
	Amount   float64 `json:"amount" binding:"required,gt=0"`
	Note     string  `json:"note"`
	Category string  `json:"category"` // required on create, ignored on update (not editable)
}

// ExpenseListQueryParams filters GET /finance/expenses.
type ExpenseListQueryParams struct {
	Category string `form:"category"`
	From     string `form:"from"`
	To       string `form:"to"`
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
	Date           string  `json:"date"` // YYYY-MM-DD
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
	OrdersCount     int       `json:"orders_count"`     // delivered in period
	TotalRevenue    float64   `json:"total_revenue"`    // SUM(total_amount) delivered
	TotalCommission float64   `json:"total_commission"` // seller_commission_earned events
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
	TeamName       string    `json:"team_name"`      // from teams.name (may be empty string)
	TeamLeadName   string    `json:"team_lead_name"` // from users.full_name
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
