package dispatcher_settlements

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts dispatcher<->company settlement routes.
// Expected to be called with v1.Group("/settlements").
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	ownerOnly := middleware.RequireRoles("owner")
	dispatcherOnly := middleware.RequireRoles("dispatcher")
	auth := middleware.RequireAuth()

	// Owner: aggregate KPIs + full history + review.
	rg.GET("/summary", auth, ownerOnly, h.getOwnerSummary)
	rg.GET("", auth, ownerOnly, h.listOwnerSettlements)
	rg.POST("/:id/confirm", auth, ownerOnly, h.confirmSettlement)
	rg.POST("/:id/reject", auth, ownerOnly, h.rejectSettlement)

	// Dispatcher: own KPIs + own history + submit.
	rg.GET("/mine/summary", auth, dispatcherOnly, h.getMySummary)
	rg.GET("/mine", auth, dispatcherOnly, h.listMySettlements)
	rg.POST("/mine", auth, dispatcherOnly, h.submitSettlement)
}
