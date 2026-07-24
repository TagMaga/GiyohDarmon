package onboarding

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the onboarding service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Create handles POST /public/worker-applications — public, unauthenticated.
func (h *Handler) Create(c *gin.Context) {
	var req CreateApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	a, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToSubmitResponse(a))
}

// List handles GET /worker-applications — owner-only.
func (h *Handler) List(c *gin.Context) {
	status := Status(c.Query("status"))
	list, err := h.svc.List(c.Request.Context(), status)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToApplicationResponseList(list))
}

// GetByID handles GET /worker-applications/:id — owner-only.
func (h *Handler) GetByID(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	a, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToApplicationResponse(a))
}

// Approve handles POST /worker-applications/:id/approve — owner-only.
func (h *Handler) Approve(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req ApproveApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	claims := middleware.ClaimsFromContext(c)
	u, err := h.svc.Approve(c.Request.Context(), id, claims.UserID, req.Role)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"user_id": u.ID})
}

// Reject handles POST /worker-applications/:id/reject — owner-only. Deletes
// the application outright (see Service.Reject).
func (h *Handler) Reject(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Reject(c.Request.Context(), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// parseUUID parses a UUID path param and writes a 400 if invalid.
func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID: "+param))
		return uuid.Nil, false
	}
	return id, true
}
