package courier

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all courier routes under the provided RouterGroup.
// Expected to be called with v1.Group("/courier").
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	courierRoles := middleware.RequireRoles("courier", "owner")
	auth := middleware.RequireAuth()

	// Profile
	rg.GET("/me", auth, courierRoles, h.me)

	// My active orders
	rg.GET("/my-orders", auth, courierRoles, h.myOrders)

	// Claimable orders
	rg.GET("/available",              auth, courierRoles, h.availableOrders)
	rg.POST("/available/:id/claim",   auth, courierRoles, h.claimOrder)
	rg.POST("/available/:id/unclaim", auth, courierRoles, h.unclaimOrder)

	// Per-order detail and delivery workflow
	rg.GET("/orders/:id",            auth, courierRoles, h.orderDetail)
	rg.POST("/orders/:id/start",     auth, courierRoles, h.startDelivery)
	rg.POST("/orders/:id/delivered", auth, courierRoles, h.markDelivered)
	rg.POST("/orders/:id/returned",  auth, courierRoles, h.markReturned)
	rg.POST("/orders/:id/issue",           auth, courierRoles, h.markIssue)
	rg.POST("/orders/:id/address-changed", auth, courierRoles, h.addressChanged)
	rg.POST("/orders/:id/defer",           auth, courierRoles, h.deferOrder)
	rg.GET("/orders/:id/notes",      auth, courierRoles, h.listNotes)
	rg.POST("/orders/:id/notes",     auth, courierRoles, h.addNote)
	rg.POST("/orders/:id/attempt",   auth, courierRoles, h.addAttempt)

	// Cash
	rg.GET("/cash/summary",    auth, courierRoles, h.cashSummary)
	rg.POST("/cash/handover",  auth, courierRoles, h.submitHandover)
	rg.GET("/cash/handovers",  auth, courierRoles, h.myHandovers)

	// Availability status
	rg.POST("/status", auth, courierRoles, h.updateStatus)

	// Push token registration
	rg.PUT("/push-token", auth, courierRoles, h.registerPushToken)
}
