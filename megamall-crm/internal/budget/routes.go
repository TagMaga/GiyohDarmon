package budget

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

func (h *Handler) RegisterRoutes(g *gin.RouterGroup) {
	ownerOnly := middleware.RequireRoles("owner")

	g.GET("/summary",                  ownerOnly, h.GetSummary)
	g.GET("/transactions",             ownerOnly, h.ListTransactions)
	g.POST("/income",                  ownerOnly, h.AddIncome)
	g.POST("/withdrawal",              ownerOnly, h.AddWithdrawal)
	g.PATCH("/transaction/:id",        ownerOnly, h.UpdateTransaction)
	g.GET("/transaction/:id/history",  ownerOnly, h.GetTransactionHistory)
	g.GET("/creators",                 ownerOnly, h.ListCreators)
}
