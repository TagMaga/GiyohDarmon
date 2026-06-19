package finance

// routes.go — Route registration for Phase 15 Owner Finance Dashboard.
//
// All /finance/* endpoints are owner-only.
// Mount point: v1.Group("/finance") in cmd/server/main.go
//
//   GET /finance/summary  — FinanceSummaryResponse (single round-trip)
//   GET /finance/events   — paginated FinanceEventResponse list
//   GET /finance/cash     — paginated FinanceCashHandoverResponse list

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all finance endpoints on the provided RouterGroup.
// The caller passes v1.Group("/finance"); this function does not create its own group.
func (h *Handler) RegisterRoutes(finance *gin.RouterGroup) {
	ownerOnly := middleware.RequireRoles("owner")

	// GET /api/v1/finance/summary?from=&to=
	finance.GET("/summary", ownerOnly, h.GetSummary)

	// GET /api/v1/finance/events?from=&to=&event_type=&page=&limit=
	finance.GET("/events", ownerOnly, h.ListEvents)

	// GET /api/v1/finance/cash?from=&to=&page=&limit=
	finance.GET("/cash", ownerOnly, h.ListCash)

	// Phase 5D executive dashboard aggregations
	finance.GET("/daily",   ownerOnly, h.GetDailyTrend)         // daily revenue trend chart
	finance.GET("/sellers", ownerOnly, h.GetSellersPerformance) // seller leaderboard
	finance.GET("/teams",   ownerOnly, h.GetTeamsPerformance)   // team performance ranking
}
