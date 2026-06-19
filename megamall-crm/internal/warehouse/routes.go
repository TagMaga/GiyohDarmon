package warehouse

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts warehouse routes.
//
// RBAC:
//   RW: owner, warehouse_manager
//   R:  dispatcher, seller, manager, sales_team_lead
//
// Sellers need read access to list warehouses when creating orders.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	writeRoles := middleware.RequireRoles("owner", "warehouse_manager")
	readRoles := middleware.RequireRoles("owner", "warehouse_manager", "dispatcher", "seller", "manager", "sales_team_lead")

	rg.GET("", readRoles, h.List)
	rg.POST("", writeRoles, h.Create)
	rg.PATCH("/:id", writeRoles, h.Update)
	rg.DELETE("/:id", writeRoles, h.Delete)
}
