package courier

import (
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

// ─── Profile ──────────────────────────────────────────────────────────────────

func (h *Handler) me(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	profile, err := h.svc.Me(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, profile)
}

// ─── My Orders ────────────────────────────────────────────────────────────────

func (h *Handler) myOrders(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	status := c.Query("status")
	orders, err := h.svc.MyOrders(c.Request.Context(), claims.UserID, status)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, orders)
}

// ─── Available Orders ─────────────────────────────────────────────────────────

func (h *Handler) availableOrders(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)
	orders, total, err := h.svc.AvailableOrders(c.Request.Context(), claims.UserID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, orders, pagination.BuildMeta(p, total))
}

func (h *Handler) claimOrder(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if svcErr := h.svc.ClaimOrder(c.Request.Context(), claims.UserID, orderID); svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.NoContent(c)
}

// ─── Delivery transitions ─────────────────────────────────────────────────────

func (h *Handler) startDelivery(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.StartDelivery(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) markDelivered(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.MarkDelivered(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) markReturned(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.MarkReturned(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) addressChanged(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AddressChangedRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	if svcErr := h.svc.AddressChanged(c.Request.Context(), claims.UserID, orderID, req.NewAddress); svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.NoContent(c)
}

func (h *Handler) deferOrder(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req DeferOrderRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil || req.ScheduledAt.IsZero() {
		response.HandleError(c, apperrors.BadRequest("scheduled_at is required"))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if svcErr := h.svc.DeferOrder(c.Request.Context(), claims.UserID, orderID, req); svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.NoContent(c)
}

func (h *Handler) markIssue(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.MarkIssue(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

// ─── Notes ────────────────────────────────────────────────────────────────────

func (h *Handler) listNotes(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	notes, svcErr := h.svc.ListNotes(c.Request.Context(), claims.UserID, orderID)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	out := make([]NoteResponse, 0, len(notes))
	for i := range notes {
		out = append(out, NoteToResponse(&notes[i]))
	}
	response.OK(c, out)
}

func (h *Handler) addNote(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AddNoteRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	note, svcErr := h.svc.AddNote(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.Created(c, NoteToResponse(note))
}

// ─── Delivery Attempts ────────────────────────────────────────────────────────

func (h *Handler) addAttempt(c *gin.Context) {
	orderID, err := parseID(c, "id")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AddAttemptRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	attempt, svcErr := h.svc.AddAttempt(c.Request.Context(), claims.UserID, orderID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.Created(c, AttemptToResponse(attempt))
}

// ─── Cash ─────────────────────────────────────────────────────────────────────

func (h *Handler) cashSummary(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	summary, err := h.svc.MyCashSummary(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, summary)
}

func (h *Handler) submitHandover(c *gin.Context) {
	var req SubmitHandoverRequest
	_ = c.ShouldBindJSON(&req) // proof_url is optional
	claims := middleware.ClaimsFromContext(c)
	handover, err := h.svc.SubmitHandover(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, HandoverToResponse(handover))
}

func (h *Handler) myHandovers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)
	handovers, total, err := h.svc.MyHandovers(c.Request.Context(), claims.UserID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]HandoverResponse, 0, len(handovers))
	for i := range handovers {
		out = append(out, HandoverToResponse(&handovers[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

// ─── Courier Status ───────────────────────────────────────────────────────────

func (h *Handler) updateStatus(c *gin.Context) {
	var req UpdateCourierStatusRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	log, err := h.svc.UpdateStatus(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, log)
}

// ─── Push Token ───────────────────────────────────────────────────────────────

func (h *Handler) registerPushToken(c *gin.Context) {
	var req RegisterPushTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.RegisterPushToken(c.Request.Context(), claims.UserID, req); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseID(c *gin.Context, param string) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		return uuid.Nil, apperrors.BadRequest("invalid uuid in path")
	}
	return id, nil
}
