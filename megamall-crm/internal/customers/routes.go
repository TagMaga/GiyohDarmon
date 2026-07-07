package customers

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts customer routes.
//
// RBAC:
//
//	Read/Create/Update: owner, sales_team_lead, manager, seller, dispatcher —
//	each scoped server-side to the orders they're entitled to see (see
//	Repository.applyCustomerScope). warehouse_manager and courier have no
//	access — neither needs customer PII for their job (inventory vs.
//	delivery execution), so it's withheld entirely rather than scoped.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	readRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher")
	writeRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher")

	rg.GET("", readRoles, h.List)
	rg.POST("", writeRoles, h.Create)
	rg.GET("/:id", readRoles, h.GetByID)
	rg.PATCH("/:id", writeRoles, h.Update)
	rg.DELETE("/:id", middleware.RequireRoles("owner", "dispatcher"), h.Delete)
	rg.GET("/:id/history", readRoles, h.GetHistory)
}
