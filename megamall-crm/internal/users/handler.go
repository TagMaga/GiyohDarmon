package users

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the user service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes mounts user routes on the given router group.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.POST("", middleware.RequireRoles(string(RoleOwner)), h.Create)
	rg.GET("", middleware.RequireRoles(string(RoleOwner)), h.List)
	rg.GET("/:id", middleware.RequireRoles(string(RoleOwner)), h.GetByID)
	rg.PATCH("/:id", middleware.RequireRoles(string(RoleOwner)), h.Update)
	rg.DELETE("/:id", middleware.RequireRoles(string(RoleOwner)), h.Delete)
	// Any authenticated user can change their own password (RequireAuth enforced).
	rg.PATCH("/:id/password", middleware.RequireAuth(), h.ChangePassword)
}

// Create handles POST /users
func (h *Handler) Create(c *gin.Context) {
	var req CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	u, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToResponse(u))
}

// List handles GET /users
func (h *Handler) List(c *gin.Context) {
	var filter ListUsersFilter
	if err := c.ShouldBindQuery(&filter); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}

	p := pagination.ParseFromQuery(c)
	users, total, err := h.svc.List(c.Request.Context(), filter, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	meta := pagination.BuildMeta(p, total)
	response.OKWithMeta(c, ToResponseList(users), meta)
}

// GetByID handles GET /users/:id
func (h *Handler) GetByID(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	u, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
}

// Update handles PATCH /users/:id
func (h *Handler) Update(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	var req UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	u, err := h.svc.Update(c.Request.Context(), id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
}

// Delete handles DELETE /users/:id
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

// ChangePassword handles PATCH /users/:id/password
func (h *Handler) ChangePassword(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	// Users can only change their own password unless they are owner.
	claims := middleware.ClaimsFromContext(c)
	if claims.UserID != id && claims.Role != string(RoleOwner) {
		response.Error(c, apperrors.Forbidden("you can only change your own password"))
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	if err := h.svc.ChangePassword(c.Request.Context(), id, req); err != nil {
		response.HandleError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// parseUUID parses a UUID path param and writes a 400 if invalid.
// Returns (uuid, true) on success or (uuid.Nil, false) on failure.
func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID: "+param))
		return uuid.Nil, false
	}
	return id, true
}
