package users

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/uploads"
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
	rg.POST("/me/avatar", middleware.RequireAuth(), h.UploadMyAvatar)

	rg.POST("", middleware.RequireRoles(string(RoleOwner)), h.Create)
	rg.GET("", middleware.RequireRoles(string(RoleOwner), string(RoleManager), string(RoleSalesTeamLead)), h.List)
	rg.GET("/history", middleware.RequireRoles(string(RoleOwner)), h.ListAllHistory)
	rg.GET("/:id/history", middleware.RequireRoles(string(RoleOwner)), h.ListHistory)
	rg.GET("/:id", middleware.RequireAuth(), h.GetByID)
	rg.PATCH("/:id", middleware.RequireRoles(string(RoleOwner)), h.Update)
	rg.DELETE("/:id", middleware.RequireRoles(string(RoleOwner)), h.Delete)
	rg.PATCH("/:id/password", middleware.RequireAuth(), h.ChangePassword)
	rg.POST("/:id/avatar", middleware.RequireRoles(string(RoleOwner)), h.UploadAvatar)
	rg.GET("/:id/documents", middleware.RequireRoles(string(RoleOwner)), h.ListDocuments)
	rg.POST("/:id/documents", middleware.RequireRoles(string(RoleOwner)), h.CreateDocument)
	rg.PATCH("/:id/documents/:document_id/status", middleware.RequireRoles(string(RoleOwner)), h.UpdateDocumentStatus)
	rg.DELETE("/:id/documents/:document_id", middleware.RequireRoles(string(RoleOwner)), h.DeleteDocument)
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

	claims := middleware.ClaimsFromContext(c)
	u, err := h.svc.Update(c.Request.Context(), id, req, claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToResponse(u))
}

// ListHistory handles GET /users/:id/history.
func (h *Handler) ListHistory(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	history, err := h.svc.ListHistory(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToHistoryResponseList(history))
}

// ListAllHistory handles GET /users/history.
func (h *Handler) ListAllHistory(c *gin.Context) {
	history, err := h.svc.ListAllHistory(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToHistoryResponseList(history))
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
	claims := middleware.ClaimsFromContext(c)
	h.uploadAvatar(c, id, claims.UserID)
}

// UploadMyAvatar handles POST /users/me/avatar — lets any authenticated user
// (e.g. a courier) upload their own profile photo.
func (h *Handler) UploadMyAvatar(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	h.uploadAvatar(c, claims.UserID, claims.UserID)
}

func (h *Handler) ListDocuments(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	docs, err := h.svc.ListDocuments(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToDocumentResponseList(docs))
}

func (h *Handler) CreateDocument(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req CreateUserDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	doc, err := h.svc.CreateDocument(c.Request.Context(), id, claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToDocumentResponse(doc))
}

func (h *Handler) DeleteDocument(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	documentID, ok := parseUUID(c, "document_id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.DeleteDocument(c.Request.Context(), id, documentID, claims.UserID); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *Handler) UpdateDocumentStatus(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	documentID, ok := parseUUID(c, "document_id")
	if !ok {
		return
	}
	var req UpdateUserDocumentStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	doc, err := h.svc.UpdateDocumentStatus(c.Request.Context(), id, documentID, claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToDocumentResponse(doc))
}

// uploadAvatar validates and stores an avatar exactly like the generic
// POST /uploads pipeline (internal/uploads) — never trusting the client's
// Content-Type header or filename/extension, which the previous
// implementation did (a stored-XSS risk: e.g. an .svg with an inline
// <script>, uploaded with a spoofed image/* Content-Type, would have been
// saved and — if ever served from a static mount — executed in the
// viewer's browser). Content is sniffed via magic bytes (uploads.Validate),
// restricted to actual image types (uploads.IsImage — excludes the PDF type
// the generic pipeline otherwise allows), and fully decoded
// (uploads.DecodeBounds) to prove it's a genuine, intact, boundedly-sized
// image rather than bytes that merely sniff as one. The stored filename is
// always server-generated (uuid + the sniffed extension), so the client's
// filename never reaches the filesystem — no path traversal, no extension
// spoofing. Files are saved into the same ./uploads/ directory the generic
// pipeline uses, so they're served by the existing, already-hardened
// GET /uploads/:filename route (re-sniffs on every request, sets
// X-Content-Type-Options: nosniff, forces attachment for non-images) instead
// of a bespoke, unserved ./uploads/avatars/ path.
func (h *Handler) uploadAvatar(c *gin.Context, id uuid.UUID, actorID uuid.UUID) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, uploads.MaxFileSize+64<<10)

	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		response.Error(c, apperrors.BadRequest("avatar file is required"))
		return
	}
	defer file.Close()

	ext, contentType, err := uploads.Validate(file, header.Size)
	if err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if !uploads.IsImage(contentType) {
		response.Error(c, apperrors.BadRequest("avatar must be an image"))
		return
	}
	if _, _, err := uploads.DecodeBounds(file); err != nil {
		response.Error(c, apperrors.BadRequest("invalid or unsupported image: "+err.Error()))
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("seek avatar file: %w", err)))
		return
	}

	if err := os.MkdirAll("./uploads", 0755); err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("create uploads dir: %w", err)))
		return
	}

	filename := uuid.New().String() + ext
	dst, err := os.Create(filepath.Join("./uploads", filename))
	if err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("save avatar: %w", err)))
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("write avatar: %w", err)))
		return
	}

	avatarURL := "/uploads/" + filename
	u, err := h.svc.Update(c.Request.Context(), id, UpdateUserRequest{AvatarURL: &avatarURL}, actorID)
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
// safe personal profile fields. Administrative fields require owner-level PATCH /users/:id.
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
