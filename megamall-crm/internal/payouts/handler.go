package payouts

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler exposes payout endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMyPayouts handles GET /payouts/me — payouts received by the caller.
func (h *Handler) GetMyPayouts(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	out, err := h.svc.GetMyPayouts(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

// GetPayablesForTeamLead handles GET /payouts/payables/team-lead/:id.
func (h *Handler) GetPayablesForTeamLead(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	teamLeadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid team lead id"))
		return
	}
	out, err := h.svc.GetPayablesForTeamLead(c.Request.Context(), claims.UserID, claims.Role, teamLeadID, c.Query("from"), c.Query("to"))
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

// GetPayeePayoutHistory handles GET /payouts/payee/:payeeId — payout history
// for one team member, scoped to payouts the calling team lead made.
func (h *Handler) GetPayeePayoutHistory(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	payeeID, err := uuid.Parse(c.Param("payeeId"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid payee id"))
		return
	}
	out, err := h.svc.GetPayeePayoutHistory(c.Request.Context(), claims.UserID, claims.Role, payeeID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

// CreatePayouts handles POST /payouts — bulk "Выплатить" action.
func (h *Handler) CreatePayouts(c *gin.Context) {
	var req CreatePayoutsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	claims := middleware.ClaimsFromContext(c)
	out, err := h.svc.CreatePayouts(c.Request.Context(), claims.UserID, claims.Role, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, out)
}

// VoidPayout handles POST /payouts/:id/void — reverses a payout.
func (h *Handler) VoidPayout(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid payout id"))
		return
	}

	var req VoidPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.VoidPayout(c.Request.Context(), claims.UserID, claims.Role, id, req.Reason); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}
