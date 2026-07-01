package orders

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all order routes.
//
// RBAC summary (full rules enforced in service.go):
//
//	Create order:          seller, manager, sales_team_lead, owner
//	View orders:           owner, sales_team_lead, manager, seller, dispatcher
//	Change status:         dispatcher, owner (+ seller can cancel own new order)
//	Add prepayment proof:  seller, dispatcher, owner
//
// warehouse_manager is intentionally excluded from orderRoles (P0 fix — Phase 24).
// The role has no natural scope over orders — it exists to manage stock, not sales —
// so there is no meaningful way to restrict order visibility for it. Warehouse
// managers access stock data via /inventory, which is what their role needs.
// Re-add warehouse_manager only if a concrete scoping need for orders emerges.
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	// Roles that may read orders. warehouse_manager excluded — no scope mapping exists.
	orderRoles := middleware.RequireRoles(
		"owner", "sales_team_lead", "manager", "seller", "dispatcher",
	)
	// Roles that can create orders.
	createRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher")
	// Roles that can change status (service enforces per-transition rules).
	statusRoles := middleware.RequireRoles("owner", "dispatcher", "seller", "manager", "sales_team_lead")
	// Roles that can add prepayments.
	prepaymentRoles := middleware.RequireRoles("owner", "dispatcher", "seller", "manager", "sales_team_lead")

	rg.GET("", orderRoles, h.ListOrders)
	rg.POST("", createRoles, h.CreateOrder)

	// Order-health stats for the owner dashboard (privileged, board-wide).
	statsRoles := middleware.RequireRoles("owner", "dispatcher")
	rg.GET("/stats", statsRoles, h.Stats)

	rg.GET("/:id", orderRoles, h.GetOrder)
	rg.PATCH("/:id", createRoles, h.UpdateOrder)

	rg.GET("/:id/timeline", orderRoles, h.GetTimeline)
	rg.POST("/:id/status", statusRoles, h.ChangeStatus)

	rg.GET("/:id/prepayments", orderRoles, h.ListPrepayments)
	rg.POST("/:id/prepayments", prepaymentRoles, h.AddPrepayment)

	// Prepayment verification (dispatcher/owner only — enforced in service).
	verifyRoles := middleware.RequireRoles("owner", "dispatcher")
	rg.POST("/:id/prepayment/verify", verifyRoles, h.VerifyPrepayment)
	rg.POST("/:id/prepayment/reject", verifyRoles, h.RejectPrepayment)

	// Attachments.
	attachmentWriteRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher")
	rg.GET("/:id/attachments", orderRoles, h.ListAttachments)
	rg.POST("/:id/attachments", attachmentWriteRoles, h.AddAttachment)

	// Phase 6: frozen financial snapshot for a delivered order.
	snapshotRoles := middleware.RequireRoles("owner", "dispatcher", "manager", "sales_team_lead")
	rg.GET("/:id/snapshot", snapshotRoles, h.GetSnapshot)

	// Comments: one shared thread visible to every role that can access the order.
	commentReadRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher", "courier")
	commentWriteRoles := middleware.RequireRoles("owner", "sales_team_lead", "manager", "seller", "dispatcher", "courier")
	rg.GET("/:id/comments", commentReadRoles, h.GetOrderComments)
	rg.POST("/:id/comments", commentWriteRoles, h.AddOrderComment)
}
