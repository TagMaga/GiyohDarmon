package products

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all product-catalog routes onto the given group.
//
// RBAC summary:
//   categories  RW: owner, warehouse_manager    R: dispatcher, seller, manager, sales_team_lead
//   suppliers   RW: owner                       R: warehouse_manager
//   products    RW: owner, warehouse_manager    R: dispatcher, seller, manager, sales_team_lead
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	writeRoles := middleware.RequireRoles("owner", "warehouse_manager")
	readRoles := middleware.RequireRoles("owner", "warehouse_manager", "dispatcher", "seller", "manager", "sales_team_lead")

	// ── Categories ────────────────────────────────────────────────────────────
	cats := rg.Group("/categories")
	{
		cats.GET("", readRoles, h.ListCategories)
		cats.POST("", writeRoles, h.CreateCategory)
		cats.PATCH("/:id", writeRoles, h.UpdateCategory)
		cats.DELETE("/:id", writeRoles, h.DeleteCategory)
	}

	// ── Suppliers ─────────────────────────────────────────────────────────────
	ownerOnly := middleware.RequireRoles("owner")
	supplierRead := middleware.RequireRoles("owner", "warehouse_manager")

	sups := rg.Group("/suppliers")
	{
		sups.GET("", supplierRead, h.ListSuppliers)
		sups.POST("", ownerOnly, h.CreateSupplier)
		sups.PATCH("/:id", ownerOnly, h.UpdateSupplier)
		sups.DELETE("/:id", ownerOnly, h.DeleteSupplier)
	}

	// ── Products ──────────────────────────────────────────────────────────────
	prods := rg.Group("/products")
	{
		prods.GET("", readRoles, h.ListProducts)
		prods.POST("", writeRoles, h.CreateProduct)

		// NOTE: /import must be registered before /:id to avoid "import" being parsed as a UUID.
		prods.POST("/import", writeRoles, h.ImportProducts)

		prods.GET("/:id", readRoles, h.GetProduct)
		prods.PATCH("/:id", writeRoles, h.UpdateProduct)
		prods.DELETE("/:id", writeRoles, h.DeleteProduct)

		// Product images
		prods.POST("/:id/images", writeRoles, h.AddProductImage)
		prods.DELETE("/:id/images/:image_id", writeRoles, h.DeleteProductImage)
	}
}
