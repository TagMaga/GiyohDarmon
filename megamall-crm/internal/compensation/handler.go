package compensation

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the compensation service.
type Handler struct {
	svc *Service
}

// NewHandler creates a compensation handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Commission config handlers ───────────────────────────────────────────────

// GetGlobalRates handles GET /hr/compensation/global
// Returns all five currently active global commission rates.
// Any authenticated user may call this (no owner restriction).
func (h *Handler) GetGlobalRates(c *gin.Context) {
	rates, err := h.svc.GetGlobalRates(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rates)
}

// ListConfigs handles GET /hr/compensation/configs
// Returns a paginated, filterable list of all commission configs.
func (h *Handler) ListConfigs(c *gin.Context) {
	filter := ConfigFilter{
		Scope: c.Query("scope"),
	}
	if s := c.Query("commission_type"); s != "" {
		ct := CommissionType(s)
		filter.CommissionType = &ct
	}
	if id, ok := parseOptionalUUID(c, "user_id"); ok {
		filter.UserID = id
	} else if c.IsAborted() {
		return
	}
	if id, ok := parseOptionalUUID(c, "team_id"); ok {
		filter.TeamID = id
	} else if c.IsAborted() {
		return
	}

	p := pagination.ParseFromQuery(c)
	list, total, err := h.svc.ListConfigs(c.Request.Context(), filter, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OKWithMeta(c, ToConfigResponseList(list), pagination.BuildMeta(p, total))
}

// CreateConfig handles POST /hr/compensation/configs
// Creates a new commission config, closing the previous active one.
func (h *Handler) CreateConfig(c *gin.Context) {
	var req CreateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	cfg, err := h.svc.CreateConfig(c.Request.Context(), extractActor(c), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToConfigResponse(cfg))
}

// GetConfigByID handles GET /hr/compensation/configs/:id
func (h *Handler) GetConfigByID(c *gin.Context) {
	id, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	cfg, err := h.svc.GetConfigByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToConfigResponse(cfg))
}

// DisableConfig handles POST /hr/compensation/configs/:id/disable
// Closes an active commission config with a mandatory reason.
func (h *Handler) DisableConfig(c *gin.Context) {
	id, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}

	var req DisableConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	if err := h.svc.DisableConfig(c.Request.Context(), extractActor(c), id, req); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// GetHistory handles GET /hr/compensation/history
// Returns paginated commission config history with optional filters.
func (h *Handler) GetHistory(c *gin.Context) {
	filter := ConfigFilter{
		Scope: c.Query("scope"),
	}
	if id, ok := parseOptionalUUID(c, "user_id"); ok {
		filter.UserID = id
	} else if c.IsAborted() {
		return
	}
	if id, ok := parseOptionalUUID(c, "team_id"); ok {
		filter.TeamID = id
	} else if c.IsAborted() {
		return
	}
	if s := c.Query("commission_type"); s != "" {
		ct := CommissionType(s)
		filter.CommissionType = &ct
	}

	p := pagination.ParseFromQuery(c)
	list, total, err := h.svc.GetHistory(c.Request.Context(), filter, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OKWithMeta(c, ToConfigResponseList(list), pagination.BuildMeta(p, total))
}

// GetEmployeeConfigs handles GET /hr/compensation/employees/:user_id
// Returns all commission configs (active + historical) for a specific employee.
func (h *Handler) GetEmployeeConfigs(c *gin.Context) {
	userID, ok := parsePathUUID(c, "user_id")
	if !ok {
		return
	}

	p := pagination.ParseFromQuery(c)
	list, total, err := h.svc.GetConfigsForEmployee(c.Request.Context(), userID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OKWithMeta(c, ToConfigResponseList(list), pagination.BuildMeta(p, total))
}

// GetTeamConfigs handles GET /hr/compensation/teams/:team_id
// Returns all commission configs (active + historical) for a specific team.
func (h *Handler) GetTeamConfigs(c *gin.Context) {
	teamID, ok := parsePathUUID(c, "team_id")
	if !ok {
		return
	}

	p := pagination.ParseFromQuery(c)
	list, total, err := h.svc.GetConfigsForTeam(c.Request.Context(), teamID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OKWithMeta(c, ToConfigResponseList(list), pagination.BuildMeta(p, total))
}

// Preview handles GET /hr/compensation/preview
// Simulates the commission breakdown for a hypothetical order.
func (h *Handler) Preview(c *gin.Context) {
	// Parse required query params.
	var params PreviewQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	if params.OrderTotal <= 0 {
		response.Error(c, apperrors.BadRequest("order_total must be greater than 0"))
		return
	}
	if params.OrderType == "" {
		response.Error(c, apperrors.BadRequest("order_type is required"))
		return
	}

	// Parse optional UUID query params.
	var userID, teamID *uuid.UUID
	if id, ok := parseOptionalUUID(c, "user_id"); ok {
		userID = id
	} else if c.IsAborted() {
		return
	}
	if id, ok := parseOptionalUUID(c, "team_id"); ok {
		teamID = id
	} else if c.IsAborted() {
		return
	}

	req := PreviewRequest{
		UserID:        userID,
		TeamID:        teamID,
		OrderTotal:    params.OrderTotal,
		OrderType:     params.OrderType,
		DeliveryFee:   params.DeliveryFee,
		CourierPayout: params.CourierPayout,
	}

	result, err := h.svc.Preview(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, result)
}

// ─── Employee compensation (fixed salary) handlers ───────────────────────────

// GetEmployeeCompensation handles GET /hr/compensation/employees/:user_id/salary
func (h *Handler) GetEmployeeCompensation(c *gin.Context) {
	userID, ok := parsePathUUID(c, "user_id")
	if !ok {
		return
	}
	ec, err := h.svc.GetEmployeeCompensation(c.Request.Context(), userID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if ec == nil {
		response.OK(c, nil)
		return
	}
	response.OK(c, ToCompensationResponse(ec))
}

// ListEmployeeCompensationHistory handles GET /hr/compensation/employees/:user_id/salary/history
func (h *Handler) ListEmployeeCompensationHistory(c *gin.Context) {
	userID, ok := parsePathUUID(c, "user_id")
	if !ok {
		return
	}
	rows, err := h.svc.ListEmployeeCompensations(c.Request.Context(), userID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]EmployeeCompensationResponse, len(rows))
	for i := range rows {
		out[i] = ToCompensationResponse(&rows[i])
	}
	response.OK(c, out)
}

// SetEmployeeCompensation handles POST /hr/compensation/employees/:user_id/salary
func (h *Handler) SetEmployeeCompensation(c *gin.Context) {
	userID, ok := parsePathUUID(c, "user_id")
	if !ok {
		return
	}
	var req SetCompensationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	ec, err := h.svc.SetEmployeeCompensation(c.Request.Context(), extractActor(c), userID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToCompensationResponse(ec))
}

// ─── Seller self-service ──────────────────────────────────────────────────────

// GetMyCompensation handles GET /hr/compensation/me.
// Returns the authenticated user's own commission rate.
func (h *Handler) GetMyCompensation(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	ec, err := h.svc.GetEmployeeCompensation(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if ec != nil {
		response.OK(c, ToCompensationResponse(ec))
		return
	}

	// No fixed salary/percent record set — fall back to the caller's
	// CommissionConfig rate (the one owners actually set from the team directory).
	resolved, err := h.svc.GetMyResolvedRate(c.Request.Context(), claims.UserID, claims.TeamID, claims.Role)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if resolved == nil {
		response.OK(c, nil)
		return
	}
	response.OK(c, ToResolvedRateResponse(resolved))
}

// TeamRankResponse is the payload for GET /hr/income/me/team-rank.
type TeamRankResponse struct {
	Rank         int `json:"rank"`
	TotalMembers int `json:"total_members"`
}

// GetTeamRank handles GET /hr/income/me/team-rank.
// Returns the authenticated seller's rank within their team based on this month's
// seller_commission_earned events. No teammate income amounts are exposed.
func (h *Handler) GetTeamRank(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	rank, total, err := h.svc.GetSellerTeamRank(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, TeamRankResponse{Rank: rank, TotalMembers: total})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// parsePathUUID parses a UUID path parameter. Writes a 400 and returns false on failure.
func parsePathUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID: "+param))
		return uuid.Nil, false
	}
	return id, true
}

// parseOptionalUUID parses a UUID from query string. Returns (nil, false) if absent.
// Returns (nil, false) and writes a 400 if present but invalid.
func parseOptionalUUID(c *gin.Context, key string) (*uuid.UUID, bool) {
	s := c.Query(key)
	if s == "" {
		return nil, false
	}
	id, err := uuid.Parse(s)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID for query param: "+key))
		c.Abort()
		return nil, false
	}
	return &id, true
}

// extractActor builds an ActorInfo from the authenticated Gin context.
func extractActor(c *gin.Context) ActorInfo {
	claims := middleware.ClaimsFromContext(c)
	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")
	return ActorInfo{
		ID:        claims.UserID,
		IPAddress: &ip,
		UserAgent: &ua,
	}
}
