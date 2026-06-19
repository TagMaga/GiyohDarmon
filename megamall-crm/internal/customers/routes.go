package customers

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts customer routes.
//
// RBAC:
//   All authenticated roles can read customers.
//   Create/Update/Delete: owner, sales_team_lead, manager, seller, dispatcher.
//   Courier has no access.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	readRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher", "warehouse_manager")
	writeRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher")

	rg.GET("", readRoles, h.List)
	rg.POST("", writeRoles, h.Create)
	rg.GET("/:id", readRoles, h.GetByID)
	rg.PATCH("/:id", writeRoles, h.Update)
	rg.DELETE("/:id", middleware.RequireRoles("owner", "dispatcher"), h.Delete)
	rg.GET("/:id/history", readRoles, h.GetHistory)
}
