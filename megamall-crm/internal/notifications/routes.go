package notifications

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts notification routes for every authenticated role —
// each request is already scoped to the caller's own notifications via
// middleware.ClaimsFromContext, so no per-role RBAC is needed here.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	auth := middleware.RequireAuth()

	rg.GET("", auth, h.List)
	rg.GET("/unread-count", auth, h.UnreadCount)
	rg.POST("/:id/read", auth, h.MarkRead)
	rg.POST("/read-all", auth, h.MarkAllRead)
}
