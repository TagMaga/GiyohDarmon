package health

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts health and readiness routes.
// Expected to be called on the v1 RouterGroup.
// Both endpoints are unauthenticated (used by load balancers and CI).
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/health", h.Health)
	rg.GET("/ready",  h.Ready)
}
