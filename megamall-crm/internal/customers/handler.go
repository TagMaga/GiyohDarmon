package customers

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the customers service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(c *gin.Context) {
	var f ListCustomersFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)
	customers, total, err := h.svc.List(c.Request.Context(), claims.UserID, claims.Role, f, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]CustomerResponse, 0, len(customers))
	for i := range customers {
		out = append(out, ToCustomerResponse(&customers[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) Create(c *gin.Context) {
	var req CreateCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	cust, err := h.svc.Create(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToCustomerResponse(cust))
}

func (h *Handler) GetByID(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	cust, err := h.svc.GetByID(c.Request.Context(), claims.UserID, claims.Role, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToCustomerResponse(cust))
}

func (h *Handler) Update(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	cust, err := h.svc.Update(c.Request.Context(), claims.UserID, claims.Role, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToCustomerResponse(cust))
}

func (h *Handler) Delete(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.Delete(c.Request.Context(), claims.UserID, claims.Role, id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *Handler) GetHistory(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	hist, err := h.svc.GetHistory(c.Request.Context(), claims.UserID, claims.Role, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, hist)
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
