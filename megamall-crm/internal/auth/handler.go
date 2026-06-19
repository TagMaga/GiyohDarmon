package auth

import (
	"github.com/gin-gonic/gin"
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

// RegisterRoutes mounts auth routes with rate limiting on login and refresh.
// store is the rate-limit backing store — pass middleware.NewMemoryStore() in
// production (swap for a Redis store later without changing this signature).
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup, store middleware.RateLimitStore) {
	rl := middleware.AuthRateLimit(store)
	rg.POST("/login",   rl, h.Login)
	rg.POST("/refresh", rl, h.Refresh)
	rg.POST("/logout",  middleware.RequireAuth(), h.Logout)
}

// Login handles POST /auth/login
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")

	pair, err := h.svc.Login(c.Request.Context(), req, ip, ua)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, pair)
}

// Refresh handles POST /auth/refresh
func (h *Handler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")

	pair, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken, ip, ua)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, pair)
}

// Logout handles POST /auth/logout
func (h *Handler) Logout(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	if err := h.svc.Logout(c.Request.Context(), claims.UserID); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}
