package pharmacies

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	read := middleware.RequireRoles("owner", "it_specialist", "warehouse_manager", "seller", "manager", "sales_team_lead")
	owner := middleware.RequireRoles("owner")
	ownerWarehouse := middleware.RequireRoles("owner", "warehouse_manager")
	sellerLike := middleware.RequireRoles("seller", "manager", "sales_team_lead")
	ownerSellerLike := middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead")

	rg.GET("", read, h.List)
	rg.GET("/dashboard", read, h.Dashboard)
	rg.GET("/:id", read, h.Detail)

	rg.POST("", ownerWarehouse, h.Create)
	rg.PUT("/:id", ownerWarehouse, h.Update)
	rg.POST("/:id/archive", ownerWarehouse, h.Archive)
	rg.POST("/:id/transfer-responsibility", ownerWarehouse, h.TransferResponsibility)

	rg.POST("/invoices", ownerWarehouse, h.CreateInvoice)
	rg.POST("/invoices/:id/accept", sellerLike, h.AcceptInvoice)
	rg.POST("/invoices/:id/reject", sellerLike, h.RejectInvoice)

	rg.POST("/payments", ownerSellerLike, h.CreatePayment)
	rg.POST("/payments/:id/confirm", owner, h.ConfirmPayment)
	rg.POST("/payments/:id/reject", owner, h.RejectPayment)
	rg.PUT("/payments/:id", owner, h.CorrectPayment)

	rg.POST("/returns", ownerSellerLike, h.CreateReturn)
	rg.POST("/returns/:id/process", ownerWarehouse, h.ProcessReturn)
}
