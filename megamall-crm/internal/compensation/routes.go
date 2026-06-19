package compensation

import (
	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

// RegisterRoutes mounts all compensation, tariff, and income routes on the /hr group.
//
// ── Commission configs (/hr/compensation) ────────────────────────────────────
//   GET  /compensation/global               — any authenticated user
//   GET  /compensation/configs              — owner only
//   POST /compensation/configs              — owner only
//   GET  /compensation/configs/:id          — owner only
//   POST /compensation/configs/:id/disable  — owner only
//   GET  /compensation/history              — owner only
//   GET  /compensation/employees/:user_id   — owner only
//   GET  /compensation/teams/:team_id       — owner only
//   GET  /compensation/preview              — owner only
//
// ── Financial events (/hr/events) ────────────────────────────────────────────
//   GET  /events  — multi-filter (order_id, user_id, event_type, from, to)
//     owner              → all events including company_revenue_earned
//     seller/manager/tl  → own events only
//     others             → 403
//
// ── Income reports (/hr/income) ───────────────────────────────────────────────
//   GET  /income/me           — owner, seller, manager, sales_team_lead
//   GET  /income/users/:id    — owner (any), manager (own sellers), tl (own team)
//   GET  /income/teams/:id    — owner (any), sales_team_lead (own team)
//
// ── Delivery tariffs (/hr/tariffs) ───────────────────────────────────────────
//   GET  /tariffs/active      — owner, sales_team_lead, manager, dispatcher
//   GET  /tariffs             — owner, sales_team_lead, manager, dispatcher
//   GET  /tariffs/:id         — owner, sales_team_lead, manager, dispatcher
//   POST /tariffs             — owner only
//   POST /tariffs/:id/deactivate — owner only
func (h *Handler) RegisterRoutes(hr *gin.RouterGroup) {
	// ── Commission config routes ───────────────────────────────────────────────
	comp := hr.Group("/compensation")
	{
		// Any authenticated user may view the global rates.
		comp.GET("/global",
			middleware.RequireAuth(),
			h.GetGlobalRates,
		)

		ownerOnly := middleware.RequireRoles("owner")

		comp.GET("/configs", ownerOnly, h.ListConfigs)
		comp.POST("/configs", ownerOnly, h.CreateConfig)
		comp.GET("/configs/:id", ownerOnly, h.GetConfigByID)
		comp.POST("/configs/:id/disable", ownerOnly, h.DisableConfig)
		comp.GET("/history", ownerOnly, h.GetHistory)
		comp.GET("/employees/:user_id", ownerOnly, h.GetEmployeeConfigs)
		comp.GET("/teams/:team_id", ownerOnly, h.GetTeamConfigs)
		comp.GET("/preview", ownerOnly, h.Preview)

		// Fixed salary / compensation kind endpoints
		comp.GET("/employees/:user_id/salary", ownerOnly, h.GetEmployeeCompensation)
		comp.GET("/employees/:user_id/salary/history", ownerOnly, h.ListEmployeeCompensationHistory)
		comp.POST("/employees/:user_id/salary", ownerOnly, h.SetEmployeeCompensation)
	}

	// ── Financial events (extended multi-filter) ──────────────────────────────
	// GET /hr/events — replaces Phase 6 order_id-only handler.
	// Backward-compatible: ?order_id= still works for owner.
	hr.GET("/events",
		middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead"),
		h.ListEvents,
	)

	// ── Income reports ─────────────────────────────────────────────────────────
	income := hr.Group("/income")
	incomeRoles := middleware.RequireRoles("owner", "seller", "manager", "sales_team_lead")
	{
		// GET /hr/income/me — self income report
		income.GET("/me", incomeRoles, h.GetMyIncome)

		// GET /hr/income/users/:id — cross-user income (RBAC enforced in service)
		income.GET("/users/:id", incomeRoles, h.GetUserIncome)

		// GET /hr/income/teams/:id — team income summary
		// :id = team lead's user_id; RBAC: owner or own team_lead
		income.GET("/teams/:id",
			middleware.RequireRoles("owner", "sales_team_lead"),
			h.GetTeamIncome,
		)
	}

	// ── Delivery tariff routes ─────────────────────────────────────────────────
	tariffs := hr.Group("/tariffs")
	{
		canViewTariff := middleware.RequireRoles("owner", "sales_team_lead", "manager", "dispatcher")

		// NOTE: /active must be before /:id so Gin doesn't match "active" as a UUID.
		tariffs.GET("/active", canViewTariff, h.GetActiveTariff)
		tariffs.GET("", canViewTariff, h.ListTariffs)
		tariffs.GET("/:id", canViewTariff, h.GetTariffByID)

		ownerOnly := middleware.RequireRoles("owner")
		tariffs.POST("", ownerOnly, h.CreateTariff)
		tariffs.POST("/:id/deactivate", ownerOnly, h.DeactivateTariff)
	}
}
