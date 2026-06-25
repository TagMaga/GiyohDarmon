package seller_payouts

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts seller payout routes.
// Mounted on the /seller-payouts group.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	// Any seller (or owner acting as seller) reads own payouts.
	selfRoles := middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead")
	rg.GET("/me", selfRoles, h.GetMyPayouts)
}
