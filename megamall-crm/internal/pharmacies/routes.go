package pharmacies

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	read := middleware.RequireRoles("owner", "it_specialist", "warehouse_manager", "seller")
	owner := middleware.RequireRoles("owner")
	ownerWarehouse := middleware.RequireRoles("owner", "warehouse_manager")
	seller := middleware.RequireRoles("seller")
	ownerSeller := middleware.RequireRoles("owner", "seller")

	rg.GET("", read, h.List)
	rg.GET("/dashboard", read, h.Dashboard)
	rg.GET("/:id", read, h.Detail)

	rg.POST("", owner, h.Create)
	rg.PUT("/:id", owner, h.Update)
	rg.POST("/:id/archive", owner, h.Archive)
	rg.POST("/:id/transfer-responsibility", owner, h.TransferResponsibility)

	rg.POST("/invoices", ownerWarehouse, h.CreateInvoice)
	rg.POST("/invoices/:id/accept", seller, h.AcceptInvoice)
	rg.POST("/invoices/:id/reject", seller, h.RejectInvoice)

	rg.POST("/payments", ownerSeller, h.CreatePayment)
	rg.POST("/payments/:id/confirm", owner, h.ConfirmPayment)
	rg.POST("/payments/:id/reject", owner, h.RejectPayment)
	rg.PUT("/payments/:id", owner, h.CorrectPayment)

	rg.POST("/returns", ownerSeller, h.CreateReturn)
	rg.POST("/returns/:id/process", ownerWarehouse, h.ProcessReturn)
}
