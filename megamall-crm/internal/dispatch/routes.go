package dispatch

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all dispatcher routes under the provided RouterGroup.
// Expected to be called with v1.Group("/dispatch").
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	dispatcherRoles := middleware.RequireRoles("dispatcher", "owner")
	auth := middleware.RequireAuth()

	// Board
	rg.GET("/board", auth, dispatcherRoles, h.getBoard)
	rg.GET("/couriers/overview", auth, dispatcherRoles, h.getCouriersOverview)
	rg.GET("/sellers", auth, dispatcherRoles, h.getSellers)
	rg.PUT("/couriers/:id", auth, dispatcherRoles, h.editCourier)
	rg.PATCH("/couriers/:id/active", auth, dispatcherRoles, h.toggleCourierActive)
	rg.PATCH("/couriers/:id/order-intake", auth, dispatcherRoles, h.updateCourierOrderIntake)
	rg.GET("/couriers/:id/tariffs", auth, dispatcherRoles, h.listCourierTariffs)
	rg.POST("/couriers/:id/tariffs", auth, dispatcherRoles, h.createCourierTariff)
	rg.DELETE("/couriers/:id/tariffs/:rule_id", auth, dispatcherRoles, h.deleteCourierTariff)
	rg.GET("/cash/settlement", auth, dispatcherRoles, h.getCashSettlement)
	rg.GET("/cash/transactions", auth, dispatcherRoles, h.listCashTransactions)
	rg.GET("/history/orders", auth, dispatcherRoles, h.listOrderHistory)

	// Order actions
	rg.POST("/orders/:id/confirm", auth, dispatcherRoles, h.confirmOrder)
	rg.POST("/orders/:id/assign", auth, dispatcherRoles, h.assignCourier)
	rg.POST("/orders/:id/reassign", auth, dispatcherRoles, h.reassignCourier)
	rg.POST("/orders/:id/unassign", auth, dispatcherRoles, h.unassignCourier)
	rg.POST("/orders/:id/schedule", auth, dispatcherRoles, h.scheduleOrder)
	rg.POST("/orders/:id/issue", auth, dispatcherRoles, h.issueOrder)
	rg.POST("/orders/:id/resolve-issue", auth, dispatcherRoles, h.resolveIssue)
	rg.POST("/orders/:id/return", auth, dispatcherRoles, h.returnOrder)
	rg.POST("/orders/:id/cancel", auth, dispatcherRoles, h.cancelOrder)
	rg.GET("/orders/:id/comments", auth, dispatcherRoles, h.listComments)
	rg.POST("/orders/:id/comments", auth, dispatcherRoles, h.addComment)

	// Cash handovers (dispatcher sees all, confirms/rejects)
	rg.GET("/cash/handovers", auth, dispatcherRoles, h.listHandovers)
	rg.POST("/cash/handovers/:id/confirm", auth, dispatcherRoles, h.confirmHandover)
	rg.POST("/cash/handovers/:id/reject", auth, dispatcherRoles, h.rejectHandover)
	rg.POST("/cash/transactions/:id/confirm", auth, dispatcherRoles, h.confirmCashTransaction)
	rg.POST("/cash/transactions/:id/reject", auth, dispatcherRoles, h.rejectCashTransaction)
}
