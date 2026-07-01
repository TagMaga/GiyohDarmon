package users

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	// Self-service routes for any authenticated user.
	rg.GET("/me", middleware.RequireAuth(), h.GetMe)
	rg.PATCH("/me", middleware.RequireAuth(), h.PatchMe)

	rg.POST("", middleware.RequireRoles(string(RoleOwner)), h.Create)
	rg.GET("", middleware.RequireRoles(string(RoleOwner), string(RoleManager), string(RoleSalesTeamLead)), h.List)
	rg.GET("/:id", middleware.RequireAuth(), h.GetByID)
	rg.PATCH("/:id", middleware.RequireRoles(string(RoleOwner)), h.Update)
	rg.DELETE("/:id", middleware.RequireRoles(string(RoleOwner)), h.Delete)
	rg.PATCH("/:id/password", middleware.RequireAuth(), h.ChangePassword)
	rg.POST("/:id/avatar", middleware.RequireRoles(string(RoleOwner)), h.UploadAvatar)
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

	if idStrs := c.QueryArray("ids[]"); len(idStrs) > 0 {
		ids := make([]uuid.UUID, 0, len(idStrs))
		for _, raw := range idStrs {
			id, err := uuid.Parse(raw)
			if err != nil {
				response.Error(c, apperrors.BadRequest("invalid UUID in ids[]: "+raw))
				return
			}
			ids = append(ids, id)
		}
		filter.IDs = ids
	}

	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)
	users, total, err := h.svc.List(c.Request.Context(), claims.UserID, claims.Role, filter, p)
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

	claims := middleware.ClaimsFromContext(c)
	allowed, err := h.svc.CanViewUser(c.Request.Context(), claims.UserID, claims.Role, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if !allowed {
		response.Error(c, apperrors.Forbidden("you do not have access to this user"))
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

// UploadAvatar handles POST /users/:id/avatar — saves a photo and updates avatar_url.
func (h *Handler) UploadAvatar(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	file, err := c.FormFile("avatar")
	if err != nil {
		response.Error(c, apperrors.BadRequest("avatar file is required"))
		return
	}

	// Validate content-type
	ct := file.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		response.Error(c, apperrors.BadRequest("file must be an image"))
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" {
		ext = ".jpg"
	}

	dir := "./uploads/avatars"
	if err := os.MkdirAll(dir, 0755); err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("create avatars dir: %w", err)))
		return
	}

	filename := fmt.Sprintf("%s%s", id.String(), ext)
	dst := filepath.Join(dir, filename)

	if err := c.SaveUploadedFile(file, dst); err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("save avatar: %w", err)))
		return
	}

	avatarURL := "/uploads/avatars/" + filename
	u, err := h.svc.Update(c.Request.Context(), id, UpdateUserRequest{AvatarURL: &avatarURL})
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
}

// GetMe handles GET /users/me — returns the authenticated user's own profile.
func (h *Handler) GetMe(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	u, err := h.svc.GetByID(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
}

// PatchMe handles PATCH /users/me — lets any authenticated user edit their own
// telegram_chat_id. All other fields require owner-level PATCH /users/:id.
func (h *Handler) PatchMe(c *gin.Context) {
	var req PatchMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	u, err := h.svc.PatchMe(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
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
