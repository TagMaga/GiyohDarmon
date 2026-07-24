package onboarding

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterPublicRoutes mounts the unauthenticated /public/worker-applications
// submission endpoint. Rate-limited by IP since it's an open internet-facing
// form (giyohdarmon.tj/new) — 5 submissions per hour per IP, generous enough
// for a genuine applicant retrying a typo but not for scripted spam.
func RegisterPublicRoutes(rg *gin.RouterGroup, h *Handler, store middleware.RateLimitStore) {
	rl := middleware.RateLimit(store, 5, time.Hour, middleware.IPPathKey)
	rg.POST("", rl, h.Create)
}

// RegisterRoutes mounts the HR-side review endpoints — owner-only, matching
// the existing rule that only an owner can create employees (POST /users).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	owner := middleware.RequireRoles("owner")
	rg.GET("", owner, h.List)
	rg.GET("/:id", owner, h.GetByID)
	rg.POST("/:id/approve", owner, h.Approve)
	rg.POST("/:id/reject", owner, h.Reject)
}
