package logistics

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

type Handler struct {
	repo *Repository
	loc  *time.Location
}

func NewHandler(repo *Repository, loc *time.Location) *Handler {
	if loc == nil {
		loc = time.UTC
	}
	return &Handler{repo: repo, loc: loc}
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

func (h *Handler) getDashboard(c *gin.Context) {
	dash, err := h.repo.GetDashboard(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, dash)
}

// ─── Couriers ─────────────────────────────────────────────────────────────────

func (h *Handler) listCouriers(c *gin.Context) {
	couriers, err := h.repo.ListCouriers(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, couriers)
}

func (h *Handler) getCourier(c *gin.Context) {
	id, err := parseUUID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	detail, err := h.repo.GetCourier(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, detail)
}

func (h *Handler) listCourierOrders(c *gin.Context) {
	id, err := parseUUID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}

	p := pagination.ParseFromQuery(c)

	params := CourierOrdersParams{}
	if s := c.Query("status"); s != "" {
		params.Status = s
	}
	if from, err := parseOptDate(c.Query("from"), h.loc); err == nil {
		params.From = from
	}
	if to, err := parseOptDate(c.Query("to"), h.loc); err == nil && to != nil {
		end := to.Add(24*time.Hour - time.Nanosecond)
		params.To = &end
	}

	orders, total, err := h.repo.ListCourierOrders(c.Request.Context(), id, p, params)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, orders, pagination.BuildMeta(p, total))
}

func (h *Handler) getCourierPerformance(c *gin.Context) {
	id, err := parseUUID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}

	from, to := h.defaultPeriod()
	if f, e := parseOptDate(c.Query("from"), h.loc); e == nil && f != nil {
		from = *f
	}
	if t, e := parseOptDate(c.Query("to"), h.loc); e == nil && t != nil {
		end := t.Add(24*time.Hour - time.Nanosecond)
		to = end
	}

	points, err := h.repo.GetCourierPerformance(c.Request.Context(), id, from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, points)
}

// ─── Cash handovers ───────────────────────────────────────────────────────────

func (h *Handler) listHandovers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)

	var courierID *uuid.UUID
	if s := c.Query("courier_id"); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			response.HandleError(c, apperrors.BadRequest("invalid courier_id"))
			return
		}
		courierID = &id
	}

	status := c.Query("status")

	var from, to *time.Time
	if f, e := parseOptDate(c.Query("from"), h.loc); e == nil {
		from = f
	}
	if t, e := parseOptDate(c.Query("to"), h.loc); e == nil && t != nil {
		end := t.Add(24*time.Hour - time.Nanosecond)
		to = &end
	}

	rows, total, err := h.repo.ListHandovers(c.Request.Context(), p, courierID, status, from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) createHandover(c *gin.Context) {
	var req CreateHandoverReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	row, err := h.repo.CreateHandover(c.Request.Context(), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, row)
}

func (h *Handler) updateHandover(c *gin.Context) {
	id, err := parseUUID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req UpdateHandoverReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	row, err := h.repo.UpdateHandover(c.Request.Context(), id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, row)
}

func (h *Handler) deleteHandover(c *gin.Context) {
	id, err := parseUUID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if err := h.repo.DeleteHandover(c.Request.Context(), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// ─── Private helpers ──────────────────────────────────────────────────────────

func parseUUID(c *gin.Context, param string) (uuid.UUID, error) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, apperrors.BadRequest(fmt.Sprintf("invalid %s: must be a UUID", param))
	}
	return id, nil
}

func parseOptDate(s string, loc *time.Location) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	if loc == nil {
		loc = time.UTC
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		local := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc).UTC()
		return &local, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t, nil
	}
	return nil, fmt.Errorf("invalid date: %s", s)
}

func (h *Handler) defaultPeriod() (time.Time, time.Time) {
	now := time.Now().In(h.loc)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, h.loc).UTC()
	end := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, h.loc).UTC()
	return start, end
}
