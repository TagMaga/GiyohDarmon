package payouts

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts payout routes on the /payouts group.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	selfRoles := middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead")
	rg.GET("/me", selfRoles, h.GetMyPayouts)

	// Manager is deliberately excluded here: the payee/payer_role columns are
	// generic enough to support a Manager-pays-Seller flow, but no screen
	// drives it yet, so there's no reason to open the route for it today.
	payerRoles := middleware.RequireRoles("owner", "sales_team_lead")
	rg.POST("", payerRoles, h.CreatePayouts)
	rg.GET("/payables/team-lead/:id", payerRoles, h.GetPayablesForTeamLead)
	rg.GET("/payee/:payeeId", payerRoles, h.GetPayeePayoutHistory)
	rg.POST("/:id/void", payerRoles, h.VoidPayout)
}
