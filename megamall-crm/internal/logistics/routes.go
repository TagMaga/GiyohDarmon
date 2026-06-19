package logistics

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all logistics routes under the provided RouterGroup.
// Expected to be called with v1.Group("/owner/logistics").
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	ownerOnly := middleware.RequireRoles("owner")
	auth := middleware.RequireAuth()

	// Dashboard
	rg.GET("/dashboard", auth, ownerOnly, h.getDashboard)

	// Courier list + detail
	rg.GET("/couriers",                    auth, ownerOnly, h.listCouriers)
	rg.GET("/couriers/:id",                auth, ownerOnly, h.getCourier)
	rg.GET("/couriers/:id/orders",         auth, ownerOnly, h.listCourierOrders)
	rg.GET("/couriers/:id/performance",    auth, ownerOnly, h.getCourierPerformance)

	// Cash handovers
	rg.GET("/cash-handovers",     auth, ownerOnly, h.listHandovers)
	rg.POST("/cash-handovers",    auth, ownerOnly, h.createHandover)
	rg.PATCH("/cash-handovers/:id",  auth, ownerOnly, h.updateHandover)
	rg.DELETE("/cash-handovers/:id", auth, ownerOnly, h.deleteHandover)
}
