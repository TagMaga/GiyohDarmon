package finance

// handler.go — HTTP handlers for Phase 15 Owner Finance Dashboard.
//
// All three handlers require the "owner" role (enforced in routes.go via middleware).
// Handler methods parse params, call repository, assemble the response DTO, and write.

import (
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
)

// Handler holds the finance repository and the local timezone for date parsing.
type Handler struct {
	repo *Repository
	loc  *time.Location
}

// NewHandler creates a finance Handler.
// loc controls how bare YYYY-MM-DD date params are interpreted (as local midnight).
func NewHandler(repo *Repository, loc *time.Location) *Handler {
	if loc == nil {
		loc = time.UTC
	}
	return &Handler{repo: repo, loc: loc}
}

// GetSummary handles GET /finance/summary?from=&to=
//
// Returns a single FinanceSummaryResponse covering:
//   - delivered-order totals (total_sales, delivery_fees, net_revenue)
//   - financial_events aggregated by event_type (excludes orphans)
//   - cash_handovers aggregated (confirmed count, pending count, collected, returned)
//
// If from/to are omitted the current calendar month is used (UTC).
func (h *Handler) GetSummary(c *gin.Context) {
	var params PeriodQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	ctx := c.Request.Context()

	// Run all aggregations in parallel using goroutines.
	type ordersResult struct {
		row ordersSummaryRow
		err error
	}
	type revenueResult struct {
		rows []eventAggRow
		err  error
	}
	type cashResult struct {
		row cashSummaryRow
		err error
	}
	type expensesResult struct {
		row expensesSummaryRow
		err error
	}

	ordersCh := make(chan ordersResult, 1)
	revenueCh := make(chan revenueResult, 1)
	cashCh := make(chan cashResult, 1)
	expensesCh := make(chan expensesResult, 1)

	go func() {
		r, e := h.repo.GetOrdersSummary(ctx, from, to)
		ordersCh <- ordersResult{r, e}
	}()
	go func() {
		r, e := h.repo.GetRevenueSummary(ctx, from, to)
		revenueCh <- revenueResult{r, e}
	}()
	go func() {
		r, e := h.repo.GetCashSummary(ctx, from, to)
		cashCh <- cashResult{r, e}
	}()
	go func() {
		r, e := h.repo.GetExpensesSummary(ctx, from, to)
		expensesCh <- expensesResult{r, e}
	}()

	ordersRes := <-ordersCh
	revenueRes := <-revenueCh
	cashRes := <-cashCh
	expensesRes := <-expensesCh

	if ordersRes.err != nil {
		response.HandleError(c, ordersRes.err)
		return
	}
	if revenueRes.err != nil {
		response.HandleError(c, revenueRes.err)
		return
	}
	if cashRes.err != nil {
		response.HandleError(c, cashRes.err)
		return
	}
	if expensesRes.err != nil {
		response.HandleError(c, expensesRes.err)
		return
	}

	// Build revenue breakdown from event_type rows. team_payouts/company_gross come
	// straight from the immutable financial_events ledger (which already applies the
	// correct, configurable commission_configs rates) — never re-derived as a
	// hardcoded percentage of orders.total_sales - orders.delivery_fees.
	rev := buildRevenueSummary(revenueRes.rows)

	commissionBase := roundFloat(ordersRes.row.TotalSales - ordersRes.row.DeliveryFees)
	if commissionBase < 0 {
		commissionBase = 0
	}
	exp := expensesRes.row
	totalBusinessExpenses := roundFloat(exp.Salaries + exp.Rent + exp.Marketing + exp.Taxes + exp.OtherBusinessExpenses)
	netProfit := computeNetProfit(rev.CompanyRevenueEarned, ordersRes.row.ProductCost, totalBusinessExpenses)

	// Build cash summary.
	cs := cashRes.row
	cashOutstanding := roundFloat(cs.CashCollected - cs.CashReturned - cs.CourierPayoutKept)

	resp := FinanceSummaryResponse{
		Period: FinancePeriod{
			// Format in local timezone so the echoed period matches the business day
			// the caller requested, not the UTC conversion of that midnight.
			From: from.In(h.loc).Format("2006-01-02"),
			To:   to.In(h.loc).Format("2006-01-02"),
		},
		Orders: FinanceOrdersSummary{
			TotalCount:         ordersRes.row.TotalCount,
			DeliveredCount:     ordersRes.row.TotalCount, // all delivered
			TotalSales:         ordersRes.row.TotalSales,
			CourierPayout:      ordersRes.row.DeliveryFees,
			ClientDeliveryFees: ordersRes.row.ClientDeliveryFees,
			NetRevenue:         ordersRes.row.NetRevenue,
			ProductCost:        ordersRes.row.ProductCost,
			CommissionBase:     commissionBase,
			TeamPayouts:        rev.TotalEmployeePayouts,
			CompanyGross:       rev.CompanyRevenueEarned,
		},
		Revenue: rev,
		Expenses: FinanceExpensesSummary{
			Salaries:              exp.Salaries,
			Rent:                  exp.Rent,
			Marketing:             exp.Marketing,
			Taxes:                 exp.Taxes,
			OtherBusinessExpenses: exp.OtherBusinessExpenses,
			TotalBusinessExpenses: totalBusinessExpenses,
			NetProfit:             netProfit,
		},
		Cash: FinanceCashSummary{
			HandoversConfirmed: cs.ConfirmedCount,
			HandoversPending:   cs.PendingCount,
			CashCollected:      cs.CashCollected,
			CashReturned:       cs.CashReturned,
			CourierPayoutKept:  cs.CourierPayoutKept,
			CashOutstanding:    cashOutstanding,
		},
	}

	response.OK(c, resp)
}

// ListEvents handles GET /finance/events?from=&to=&event_type=&order_id=&user_id=&min_amount=&max_amount=&page=&limit=
//
// Returns paginated financial_events rows.  All event types are included by
// default (including company_revenue_earned rows with user_id=NULL).
func (h *Handler) ListEvents(c *gin.Context) {
	var params EventsQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	var orderID *uuid.UUID
	if params.OrderID != "" {
		parsed, parseErr := uuid.Parse(params.OrderID)
		if parseErr != nil {
			response.Error(c, apperrors.BadRequest("invalid order_id: "+parseErr.Error()))
			return
		}
		orderID = &parsed
	}

	var userID *uuid.UUID
	if params.UserID != "" {
		parsed, parseErr := uuid.Parse(params.UserID)
		if parseErr != nil {
			response.Error(c, apperrors.BadRequest("invalid user_id: "+parseErr.Error()))
			return
		}
		userID = &parsed
	}

	if params.MinAmount != nil && *params.MinAmount < 0 {
		response.Error(c, apperrors.BadRequest("min_amount must be >= 0"))
		return
	}
	if params.MaxAmount != nil && *params.MaxAmount < 0 {
		response.Error(c, apperrors.BadRequest("max_amount must be >= 0"))
		return
	}
	if params.MinAmount != nil && params.MaxAmount != nil && *params.MinAmount > *params.MaxAmount {
		response.Error(c, apperrors.BadRequest("min_amount must be <= max_amount"))
		return
	}

	p := pagination.ParseFromQuery(c)

	events, total, err := h.repo.ListFinancialEvents(
		c.Request.Context(),
		from, to,
		params.EventType,
		orderID,
		userID,
		params.MinAmount,
		params.MaxAmount,
		p,
	)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OKWithMeta(c, events, pagination.BuildMeta(p, total))
}

// ListCash handles GET /finance/cash?from=&to=&page=&limit=
//
// Returns paginated cash_handovers rows ordered by created_at DESC.
// Supports date-range filtering via from/to (default = current month).
func (h *Handler) ListCash(c *gin.Context) {
	var params PeriodQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	p := pagination.ParseFromQuery(c)

	rows, total, err := h.repo.ListCashHandovers(c.Request.Context(), from, to, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	out := make([]FinanceCashHandoverResponse, len(rows))
	for i, r := range rows {
		out[i] = FinanceCashHandoverResponse{
			ID:                r.ID,
			CourierID:         r.CourierID,
			DispatcherID:      r.DispatcherID,
			TotalCollected:    r.TotalCollected,
			TotalDeliveryFees: r.TotalDeliveryFees,
			TotalToReturn:     r.TotalToReturn,
			ActualReturned:    r.ActualReturned,
			Status:            r.Status,
			ProofURL:          r.ProofURL,
			Comment:           r.Comment,
			ConfirmedAt:       r.ConfirmedAt,
			CreatedAt:         r.CreatedAt,
		}
	}

	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

// ─── Business expenses ─────────────────────────────────────────────────────────

// ListExpenses handles GET /finance/expenses?category=&from=&to=&page=&limit=
func (h *Handler) ListExpenses(c *gin.Context) {
	var q ExpenseListQueryParams
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if q.Category != "" && !IsValidExpenseCategory(ExpenseCategory(q.Category)) {
		response.Error(c, apperrors.BadRequest("invalid expense category"))
		return
	}

	p := pagination.ParseFromQuery(c)
	params := ExpenseListParams{Category: q.Category, Page: p.Page, Limit: p.Limit}
	if q.From != "" {
		t, err := parseLocalDate(q.From, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid from date"))
			return
		}
		params.From = &t
	}
	if q.To != "" {
		t, err := parseLocalDate(q.To, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid to date"))
			return
		}
		params.To = &t
	}

	rows, total, err := h.repo.ListExpenses(c.Request.Context(), params)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, int(total)))
}

// CreateExpense handles POST /finance/expenses
func (h *Handler) CreateExpense(c *gin.Context) {
	var req ExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	category := ExpenseCategory(req.Category)
	if !IsValidExpenseCategory(category) {
		response.Error(c, apperrors.BadRequest("invalid expense category"))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if claims == nil {
		response.Error(c, apperrors.Unauthorized("not authenticated"))
		return
	}
	row, err := h.repo.AddExpense(c.Request.Context(), claims.UserID, req.Amount, req.Note, category)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, row)
}

// UpdateExpense handles PATCH /finance/expenses/:id
// Only amount and note are editable — category is fixed at creation.
func (h *Handler) UpdateExpense(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid expense id"))
		return
	}
	var req ExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if claims == nil {
		response.Error(c, apperrors.Unauthorized("not authenticated"))
		return
	}
	if err := h.repo.UpdateExpense(c.Request.Context(), id, claims.UserID, req.Amount, req.Note); err != nil {
		if errors.Is(err, ErrExpenseNotFound) {
			response.Error(c, apperrors.NotFound("expense not found"))
			return
		}
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"updated": true})
}

// GetExpenseHistory handles GET /finance/expenses/:id/history
func (h *Handler) GetExpenseHistory(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid expense id"))
		return
	}
	rows, err := h.repo.ListExpenseHistory(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rows)
}

// ─── Phase 5D handlers ───────────────────────────────────────────────────────

// GetDailyTrend handles GET /finance/daily?from=&to=
// Returns one DailyPoint per calendar day — used for revenue/profit trend charts.
func (h *Handler) GetDailyTrend(c *gin.Context) {
	var params PeriodQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	rows, err := h.repo.GetDailyRevenue(c.Request.Context(), from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	out := make([]DailyPoint, len(rows))
	for i, r := range rows {
		out[i] = DailyPoint{
			Date:           r.Date,
			OrdersCount:    r.OrdersCount,
			TotalSales:     r.TotalSales,
			DeliveryFees:   r.DeliveryFees,
			CompanyRevenue: r.CompanyRevenue,
		}
	}
	response.OK(c, out)
}

// GetSellersPerformance handles GET /finance/sellers?from=&to=&limit=
// Returns top sellers ranked by delivered-order revenue.
func (h *Handler) GetSellersPerformance(c *gin.Context) {
	var params LimitQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	limit := params.Limit
	if limit <= 0 {
		limit = 10
	}

	rows, err := h.repo.GetSellerPerformance(c.Request.Context(), from, to, limit)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	out := make([]SellerPerformanceRow, len(rows))
	for i, r := range rows {
		out[i] = SellerPerformanceRow{
			Rank:            i + 1,
			SellerID:        r.SellerID,
			FullName:        r.FullName,
			OrdersCount:     r.OrdersCount,
			TotalRevenue:    r.TotalRevenue,
			TotalCommission: r.TotalCommission,
		}
	}
	response.OK(c, out)
}

// GetTeamsPerformance handles GET /finance/teams?from=&to=
// Returns all teams with delivered-order revenue, ranked descending.
func (h *Handler) GetTeamsPerformance(c *gin.Context) {
	var params PeriodQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	from, to, err := parsePeriod(params.From, params.To, h.loc)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	rows, err := h.repo.GetTeamPerformance(c.Request.Context(), from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	out := make([]TeamPerformanceRow, len(rows))
	for i, r := range rows {
		out[i] = TeamPerformanceRow{
			TeamLeadID:     r.TeamLeadID,
			TeamName:       r.TeamName,
			TeamLeadName:   r.TeamLeadName,
			OrdersCount:    r.OrdersCount,
			TotalRevenue:   r.TotalRevenue,
			CompanyRevenue: r.CompanyRevenue,
		}
	}
	response.OK(c, out)
}

// ─── Private helpers ──────────────────────────────────────────────────────────

// buildRevenueSummary maps event_type aggregate rows to FinanceRevenueSummary.
// Unknown event types are silently ignored (forward-compatible with new types).
func buildRevenueSummary(rows []eventAggRow) FinanceRevenueSummary {
	rev := FinanceRevenueSummary{}
	for _, r := range rows {
		switch r.EventType {
		case "company_revenue_earned":
			rev.CompanyRevenueEarned = r.Total
		case "seller_commission_earned":
			rev.SellerCommissionEarned = r.Total
		case "manager_personal_commission_earned":
			rev.ManagerPersonalCommissionEarned = r.Total
		case "manager_team_commission_earned":
			rev.ManagerTeamCommissionEarned = r.Total
		case "team_lead_pool_earned":
			rev.TeamLeadPoolEarned = r.Total
		case "courier_fee_earned":
			rev.CourierPayouts = r.Total
		}
	}
	rev.TotalEmployeePayouts = roundFloat(
		rev.SellerCommissionEarned +
			rev.ManagerPersonalCommissionEarned +
			rev.ManagerTeamCommissionEarned +
			rev.TeamLeadPoolEarned,
	)
	return rev
}

// parsePeriod parses YYYY-MM-DD date strings into UTC time.Time bounds.
// Bare YYYY-MM-DD strings are treated as midnight in loc (so "today" means
// the local business day, not the UTC day). RFC3339 timestamps carry their own
// timezone and are passed through unchanged. Both strings default to the current
// calendar month in loc if empty.
func parsePeriod(fromStr, toStr string, loc *time.Location) (time.Time, time.Time, error) {
	if loc == nil {
		loc = time.UTC
	}
	from, to := defaultPeriod(loc)

	if fromStr != "" {
		t, err := parseLocalDate(fromStr, loc)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid from date %q: %w", fromStr, err)
		}
		from = t.UTC()
	}
	if toStr != "" {
		t, err := parseLocalDate(toStr, loc)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid to date %q: %w", toStr, err)
		}
		// Include the full end day (add 24h then subtract 1ns to stay within the day).
		to = t.Add(24*time.Hour - time.Nanosecond).UTC()
	}
	return from, to, nil
}

// parseLocalDate parses a date string interpreting bare YYYY-MM-DD as midnight
// in loc. RFC3339 / RFC3339Nano timestamps retain their explicit timezone.
func parseLocalDate(s string, loc *time.Location) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		// Reinterpret as start of the local calendar day, not UTC midnight.
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc), nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("use YYYY-MM-DD or RFC3339")
}

// defaultPeriod returns (start of current month, end of today) in loc.
func defaultPeriod(loc *time.Location) (time.Time, time.Time) {
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	end := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, loc)
	return start.UTC(), end.UTC()
}

// roundFloat rounds to 2 decimal places to avoid floating-point drift in sums.
func roundFloat(f float64) float64 {
	// Use integer arithmetic to avoid importing math/big.
	shifted := f * 100
	if shifted >= 0 {
		shifted = float64(int64(shifted+0.5)) / 100
	} else {
		shifted = float64(int64(shifted-0.5)) / 100
	}
	return shifted
}
