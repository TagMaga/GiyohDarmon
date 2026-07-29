package warehouses

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts owner/warehouse_manager-facing warehouse routes
// (mounted at /api/v1/warehouses).
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	manage := middleware.RequireRoles("owner", "warehouse_manager")

	rg.GET("/inventory/summary", manage, h.InventorySummary)
	rg.GET("/inventory/distribution", manage, h.InventoryDistribution)
	rg.GET("/couriers", manage, h.ListCouriers)
	rg.GET("", manage, h.ListWarehouses)
	rg.POST("", manage, h.CreateWarehouse)

	rg.POST("/transfers", manage, h.CreateTransfer)
	rg.GET("/transfers", manage, h.ListTransfers)
	rg.GET("/transfers/:id", manage, h.GetTransfer)

	rg.GET("/returns", manage, h.ListReturns)
	rg.POST("/returns/:id/accept", manage, h.AcceptReturn)
	rg.POST("/returns/:id/reject", manage, h.RejectReturn)

	rg.GET("/lost-reports", manage, h.ListLostReports)
	rg.POST("/lost-reports/:id/decide", manage, h.DecideLostReport)
}

// RegisterCourierRoutes mounts the courier-facing "My Warehouse" routes
// (mounted at /api/v1/courier/warehouse). Couriers may only ever act on
// their own warehouse/transfers — every handler resolves scope from the
// authenticated courier's claims, never from a path parameter.
func (h *Handler) RegisterCourierRoutes(rg *gin.RouterGroup) {
	courierOnly := middleware.RequireRoles("courier")

	rg.GET("", courierOnly, h.MyWarehouse)
	rg.GET("/transfers", courierOnly, h.MyTransfers)
	rg.POST("/transfers/:id/accept", courierOnly, h.AcceptTransfer)
	rg.POST("/transfers/:id/reject", courierOnly, h.RejectTransfer)
	rg.POST("/returns", courierOnly, h.CreateReturn)
	rg.POST("/lost-reports", courierOnly, h.CreateLostReport)
	rg.GET("/lost-reports", courierOnly, h.MyLostReports)
}
