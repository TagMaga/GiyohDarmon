package dispatcher_settlements

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func parseDateRange(c *gin.Context) (*time.Time, *time.Time, error) {
	var from, to *time.Time
	if v := c.Query("from"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return nil, nil, apperrors.BadRequest("invalid from date")
		}
		from = &t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return nil, nil, apperrors.BadRequest("invalid to date")
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		to = &endOfDay
	}
	return from, to, nil
}

// ─── Owner ────────────────────────────────────────────────────────────────────

func (h *Handler) getOwnerSummary(c *gin.Context) {
	from, to, err := parseDateRange(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var dispatcherID *uuid.UUID
	if v := c.Query("dispatcher_id"); v != "" {
		id, parseErr := uuid.Parse(v)
		if parseErr != nil {
			response.HandleError(c, apperrors.BadRequest("invalid dispatcher_id"))
			return
		}
		dispatcherID = &id
	}
	summary, svcErr := h.svc.GetSummaryForOwner(c.Request.Context(), SummaryFilter{From: from, To: to, DispatcherID: dispatcherID})
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, summary)
}

func (h *Handler) listOwnerSettlements(c *gin.Context) {
	from, to, err := parseDateRange(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var dispatcherID *uuid.UUID
	if v := c.Query("dispatcher_id"); v != "" {
		id, parseErr := uuid.Parse(v)
		if parseErr != nil {
			response.HandleError(c, apperrors.BadRequest("invalid dispatcher_id"))
			return
		}
		dispatcherID = &id
	}
	p := pagination.ParseFromQuery(c)
	rows, total, svcErr := h.svc.ListForOwner(c.Request.Context(), ListFilter{
		From: from, To: to, DispatcherID: dispatcherID, Status: c.Query("status"),
	}, p)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func parseSettlementID(c *gin.Context) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, apperrors.BadRequest("invalid settlement id")
	}
	return id, nil
}

func (h *Handler) confirmSettlement(c *gin.Context) {
	id, err := parseSettlementID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req ConfirmRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	settlement, svcErr := h.svc.Confirm(c.Request.Context(), claims.UserID, id, req.ActualReceived, req.AdminNote)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, settlement)
}

func (h *Handler) rejectSettlement(c *gin.Context) {
	id, err := parseSettlementID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req RejectRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	settlement, svcErr := h.svc.Reject(c.Request.Context(), claims.UserID, id, req.Reason)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, settlement)
}

// editSettlement corrects an already-finalized (confirmed/rejected)
// settlement — mirrors logistics' post-decision "Изменить" flow.
func (h *Handler) editSettlement(c *gin.Context) {
	id, err := parseSettlementID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req EditRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	settlement, svcErr := h.svc.Edit(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, settlement)
}

func (h *Handler) listSettlementHistory(c *gin.Context) {
	id, err := parseSettlementID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	edits, svcErr := h.svc.ListEdits(c.Request.Context(), id)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, edits)
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

func (h *Handler) getMySummary(c *gin.Context) {
	from, to, err := parseDateRange(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	summary, svcErr := h.svc.GetSummaryForDispatcher(c.Request.Context(), claims.UserID, from, to)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, summary)
}

func (h *Handler) listMySettlements(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	p := pagination.ParseFromQuery(c)
	rows, total, svcErr := h.svc.ListForDispatcher(c.Request.Context(), claims.UserID, p)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) submitSettlement(c *gin.Context) {
	var req CreateRequest
	_ = c.ShouldBindJSON(&req) // comment is optional
	claims := middleware.ClaimsFromContext(c)
	settlement, svcErr := h.svc.Submit(c.Request.Context(), claims.UserID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.Created(c, settlement)
}
