package media

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterManagementRoutes mounts the authenticated upload/get/delete/
// signed-url endpoints onto rg (expected to be v1.Group("/media")). Every
// authenticated role may upload/manage its own media; Authorize (see
// service.go) restricts get/delete/sign to the uploader or an owner-level
// role. Upload is additionally per-user rate limited — an authenticated
// user, not an IP, is the right key here since the endpoint requires auth
// and a shared-IP office/NAT should not throttle unrelated users together.
func (h *Handler) RegisterManagementRoutes(rg *gin.RouterGroup, store middleware.RateLimitStore) {
	auth := middleware.RequireAuth()
	uploadLimit := middleware.RateLimit(store, 30, time.Minute, uploaderKey)

	rg.POST("", auth, uploadLimit, h.Upload)
	rg.GET("/:id", auth, h.Get)
	rg.DELETE("/:id", auth, h.Delete)
	rg.GET("/:id/signed-url", auth, h.MintSignedURL)
}

// RegisterDeliveryRoutes mounts the unauthenticated file-serving endpoints
// at the router root (matching the existing /uploads/:filename convention)
// — these are deliberately outside /api/v1 and outside RequireAuth, since
// the private path is authorized by signature, not by session, and the
// public path needs no authorization at all.
func RegisterDeliveryRoutes(router gin.IRouter, h *Handler) {
	router.GET("/media/public/:key", h.PublicDelivery)
	router.GET("/media/private/:key", h.PrivateDelivery)
}

// uploaderKey buckets the rate limiter by authenticated user ID rather than
// IP — RequireAuth has already run by the time this executes, so claims are
// guaranteed present.
func uploaderKey(c *gin.Context) string {
	claims := middleware.ClaimsFromContext(c)
	return "media-upload:" + claims.UserID.String()
}
