package hierarchy

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	ownerOnly := middleware.RequireRoles("owner")
	rg.POST("/assign", ownerOnly, h.Assign)
	rg.GET("/user/:user_id", middleware.RequireRoles("owner", "sales_team_lead", "manager"), h.GetUserChain)
	rg.GET("/team/:team_id/members", middleware.RequireRoles("owner", "sales_team_lead", "manager"), h.GetTeamMembers)
}

// Assign handles POST /hierarchy/assign
func (h *Handler) Assign(c *gin.Context) {
	var req AssignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	entry, err := h.svc.Assign(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, toResponse(entry))
}

// GetUserChain handles GET /hierarchy/user/:user_id
func (h *Handler) GetUserChain(c *gin.Context) {
	userID, ok := parseUUID(c, "user_id")
	if !ok {
		return
	}

	chain, err := h.svc.GetUserChain(c.Request.Context(), userID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"chain": chain})
}

// GetTeamMembers handles GET /hierarchy/team/:team_id/members
func (h *Handler) GetTeamMembers(c *gin.Context) {
	teamID, ok := parseUUID(c, "team_id")
	if !ok {
		return
	}

	members, err := h.svc.GetTeamMembers(c.Request.Context(), teamID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"members": members})
}

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID: "+param))
		return uuid.Nil, false
	}
	return id, true
}
