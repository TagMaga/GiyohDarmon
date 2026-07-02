package inventory

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all inventory routes onto the given group.
//
// RBAC:
//
//	Read:   owner, warehouse_manager, dispatcher
//	Write:  owner, warehouse_manager
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	readRoles := middleware.RequireRoles("owner", "warehouse_manager", "dispatcher")
	writeRoles := middleware.RequireRoles("owner", "warehouse_manager")

	// Inventory reads
	rg.GET("", readRoles, h.ListInventory)
	rg.GET("/product/:id", readRoles, h.GetInventoryByProduct)
	rg.GET("/movements", readRoles, h.ListMovements)

	// FIFO batch reads (?product_id=&only_active=true)
	rg.GET("/batches", readRoles, h.ListBatches)
	rg.GET("/integrity", readRoles, h.InventoryIntegrityCheck)
	rg.GET("/receiving/:id/history", readRoles, h.ListReceivingHistory)

	// Mutations
	rg.POST("/receiving", writeRoles, h.CreateReceiving)
	rg.PATCH("/receiving/:id", writeRoles, h.UpdateReceiving)
	rg.POST("/adjustments", writeRoles, h.CreateAdjustment)
	rg.POST("/writeoffs", writeRoles, h.CreateWriteoff)
}
