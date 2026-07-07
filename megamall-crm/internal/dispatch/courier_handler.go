package dispatch

// courier_handler.go — Dispatcher endpoints for courier management:
//   PUT  /dispatch/couriers/:id           — edit courier profile
//   PATCH /dispatch/couriers/:id/active   — toggle courier is_active
//   GET  /dispatch/couriers/:id/tariffs   — list per-courier tariff rules
//   POST /dispatch/couriers/:id/tariffs   — add tariff rule
//   DELETE /dispatch/couriers/tariffs/:rule_id — delete tariff rule

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	courier_tariffs "github.com/megamall/crm/internal/courier_tariffs"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// ─── Edit Courier ─────────────────────────────────────────────────────────────

func (h *Handler) editCourier(c *gin.Context) {
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req UpdateCourierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if validErr := validator.Validate(req); validErr != nil {
		response.HandleError(c, validErr)
		return
	}
	updated, svcErr := h.svc.UpdateCourier(c.Request.Context(), courierID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, updated)
}

// ─── Toggle courier active ────────────────────────────────────────────────────

func (h *Handler) toggleCourierActive(c *gin.Context) {
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req ToggleCourierActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	updated, svcErr := h.svc.ToggleCourierActive(c.Request.Context(), courierID, req.Active)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, updated)
}

// ─── Courier Tariff Rules ─────────────────────────────────────────────────────

func (h *Handler) listCourierTariffs(c *gin.Context) {
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	db := h.svc.db
	repo := courier_tariffs.NewRepository(db)
	svc := courier_tariffs.NewService(repo)
	rules, svcErr := svc.ListByCourier(c.Request.Context(), courierID)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, rules)
}

func (h *Handler) createCourierTariff(c *gin.Context) {
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req courier_tariffs.CreateTariffRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if validErr := validator.Validate(req); validErr != nil {
		response.HandleError(c, validErr)
		return
	}
	db := h.svc.db
	repo := courier_tariffs.NewRepository(db)
	svc := courier_tariffs.NewService(repo)
	rule, svcErr := svc.Create(c.Request.Context(), courierID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}

	actorID := middleware.ClaimsFromContext(c).UserID
	h.svc.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "courier_tariff_rule",
		EntityID:   &rule.ID,
		AfterState: rule,
	})

	response.Created(c, rule)
}

func (h *Handler) deleteCourierTariff(c *gin.Context) {
	ruleIDStr := c.Param("rule_id")
	ruleID, err := uuid.Parse(ruleIDStr)
	if err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid rule_id"))
		return
	}
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	db := h.svc.db
	repo := courier_tariffs.NewRepository(db)
	svc := courier_tariffs.NewService(repo)

	existing, svcErr := svc.GetByID(c.Request.Context(), ruleID)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}

	if svcErr := svc.Delete(c.Request.Context(), ruleID, courierID); svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}

	actorID := middleware.ClaimsFromContext(c).UserID
	h.svc.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "delete",
		EntityType:  "courier_tariff_rule",
		EntityID:    &ruleID,
		BeforeState: existing,
	})

	response.NoContent(c)
}
