package teams

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
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
	rg.POST("", ownerOnly, h.Create)
	rg.GET("", middleware.RequireRoles("owner", "sales_team_lead", "manager"), h.List)
	rg.GET("/:id", middleware.RequireRoles("owner", "sales_team_lead", "manager"), h.GetByID)
	rg.PATCH("/:id", ownerOnly, h.Update)
	rg.DELETE("/:id", ownerOnly, h.Delete)
}

func (h *Handler) Create(c *gin.Context) {
	var req CreateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	t, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToResponse(t))
}

func (h *Handler) List(c *gin.Context) {
	var filter ListTeamsFilter
	if err := c.ShouldBindQuery(&filter); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	p := pagination.ParseFromQuery(c)
	teams, total, err := h.svc.List(c.Request.Context(), filter, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	meta := pagination.BuildMeta(p, total)
	response.OKWithMeta(c, ToResponseList(teams), meta)
}

func (h *Handler) GetByID(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	t, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(t))
}

func (h *Handler) Update(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	var req UpdateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	t, err := h.svc.Update(c.Request.Context(), id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(t))
}

func (h *Handler) Delete(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
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
