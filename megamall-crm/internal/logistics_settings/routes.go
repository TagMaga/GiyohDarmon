package logistics_settings

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts logistics-settings routes on the v1 group.
// All routes require authentication; owner-only enforcement happens per-handler.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	auth := middleware.RequireAuth()

	// Cities — readable by any authenticated role (order creation needs the list);
	// create/toggle are owner-only (enforced in handler).
	v1.GET("/cities", auth, h.listCities)
	v1.POST("/cities", auth, h.createCity)
	v1.PATCH("/cities/:id", auth, h.toggleCity)

	// Per-courier payout profile — owner only (enforced in handler).
	v1.GET("/couriers/:id/payout", auth, h.getCourierPayout)
	v1.PUT("/couriers/:id/payout", auth, h.updateCourierPayout)
}
