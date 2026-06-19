package warehouse

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the warehouse service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	warehouses, total, err := h.svc.List(c.Request.Context(), p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]WarehouseResponse, 0, len(warehouses))
	for i := range warehouses {
		out = append(out, ToWarehouseResponse(&warehouses[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) Create(c *gin.Context) {
	var req CreateWarehouseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	w, err := h.svc.Create(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToWarehouseResponse(w))
}

func (h *Handler) Update(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateWarehouseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	w, err := h.svc.Update(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToWarehouseResponse(w))
}

func (h *Handler) Delete(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.Delete(c.Request.Context(), claims.UserID, id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid "+param+": must be a UUID"))
		c.Abort()
		return uuid.Nil, false
	}
	return id, true
}
