package payouts

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts payout routes on the /payouts group.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	selfRoles := middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead")
	rg.GET("/me", selfRoles, h.GetMyPayouts)

	payerRoles := middleware.RequireRoles("owner", "sales_team_lead")
	rg.POST("", payerRoles, h.CreatePayouts)
	rg.GET("/payables/team-lead/:id", payerRoles, h.GetPayablesForTeamLead)
}
