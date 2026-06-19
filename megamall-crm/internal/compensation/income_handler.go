package compensation

// income_handler.go — HTTP handlers for Phase 14 income endpoints.
//
// Routes registered in routes.go:
//   GET /hr/income/me          → GetMyIncome
//   GET /hr/income/users/:id   → GetUserIncome
//   GET /hr/income/teams/:id   → GetTeamIncome
//   GET /hr/events             → ListEvents  (replaces ListEventsByOrder)

import (
	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
)

// GetMyIncome handles GET /hr/income/me
// Returns income report for the authenticated user.
// Allowed roles: owner, seller, manager, sales_team_lead.
func (h *Handler) GetMyIncome(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	var params IncomeQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	report, err := h.svc.GetMyIncome(c.Request.Context(), claims.UserID, claims.Role, params)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, report)
}

// GetUserIncome handles GET /hr/income/users/:id
// Returns income report for the specified user, enforcing RBAC:
//   owner      → any user
//   manager    → only sellers under their management
//   team_lead  → only their team members
//   seller     → forbidden (use /me instead)
func (h *Handler) GetUserIncome(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	targetID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}

	var params IncomeQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	report, err := h.svc.GetUserIncome(
		c.Request.Context(),
		claims.UserID,
		claims.Role,
		targetID,
		params,
	)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, report)
}

// GetTeamIncome handles GET /hr/income/teams/:id
// :id is the team lead's user_id (not a teams.id), because income is
// aggregated via orders.team_lead_id.
// Allowed roles: owner (any team), sales_team_lead (own team only).
func (h *Handler) GetTeamIncome(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	teamLeadID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}

	var params IncomeQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	report, err := h.svc.GetTeamIncome(
		c.Request.Context(),
		claims.UserID,
		claims.Role,
		teamLeadID,
		params,
	)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, report)
}

// ListEvents handles GET /hr/events (extended multi-filter version).
//
// Supported query params:
//   order_id   uuid    — filter to one order (owner only for full event set)
//   user_id    uuid    — filter by user (owner only; other roles get self forced)
//   event_type string  — filter to one event type
//   from       date    — YYYY-MM-DD lower bound on created_at
//   to         date    — YYYY-MM-DD upper bound on created_at
//   page       int     — pagination page (default 1)
//   limit      int     — page size (default 100, max 100)
//
// Role visibility:
//   owner              → sees all events including company_revenue_earned
//   seller/manager/tl  → forced to own user_id; company events excluded
//   other roles        → 403
//
// Response shape uses snake_case EventListResponse DTOs.
// Backward-compatible: ?order_id=X still works for owner (returns snake_case now).
func (h *Handler) ListEvents(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	var filter FinancialEventFilter

	if id, ok := parseOptionalUUID(c, "order_id"); ok {
		filter.OrderID = id
	} else if c.IsAborted() {
		return
	}

	if id, ok := parseOptionalUUID(c, "user_id"); ok {
		filter.UserID = id
	} else if c.IsAborted() {
		return
	}

	if et := c.Query("event_type"); et != "" {
		filter.EventType = FinancialEventType(et)
	}

	// Optional date range — no default here; service/repo handle nil as "no filter".
	fromStr := c.Query("from")
	toStr := c.Query("to")
	if fromStr != "" || toStr != "" {
		from, to, err := parsePeriod(fromStr, toStr)
		if err != nil {
			response.Error(c, apperrors.BadRequest(err.Error()))
			return
		}
		filter.From = &from
		filter.To = &to
	}

	// Default limit is 100 (= MaxLimit) so callers that previously received an
	// unbounded flat array get the same full result in a single page by default.
	// Explicit ?limit=N still works and is capped at MaxLimit=100.
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)

	events, total, err := h.svc.ListEvents(
		c.Request.Context(),
		claims.UserID,
		claims.Role,
		filter,
		p,
	)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	out := make([]EventListResponse, len(events))
	for i, e := range events {
		out[i] = toEventListResponse(e)
	}

	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}
