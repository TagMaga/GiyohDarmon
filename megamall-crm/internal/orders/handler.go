package orders

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// parseDayStart parses a YYYY-MM-DD string into the start of that UTC day.
// Empty string → nil (unbounded).
func parseDayStart(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// parseDayEnd parses a YYYY-MM-DD string into the end of that UTC day (23:59:59.999…).
// Empty string → nil (unbounded).
func parseDayEnd(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, err
	}
	end := t.Add(24*time.Hour - time.Nanosecond)
	return &end, nil
}

// Handler wires HTTP routes to the orders service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Orders ───────────────────────────────────────────────────────────────────

func (h *Handler) ListOrders(c *gin.Context) {
	var f ListOrdersFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)

	orders, total, err := h.svc.List(c.Request.Context(), f, claims.UserID, claims.Role, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]OrderResponse, 0, len(orders))
	ids := make([]uuid.UUID, 0, len(orders))
	for i := range orders {
		out = append(out, ToOrderResponse(&orders[i]))
		ids = append(ids, orders[i].ID)
	}
	h.enrichCourierDisplay(c.Request.Context(), out, orders, ids)
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

// enrichCourierDisplay populates the courier_* fields on each response using
// resolved assignment history, so delivered/active orders show the right courier.
// Failures are non-fatal — courier display is best-effort, never blocks the list.
func (h *Handler) enrichCourierDisplay(ctx context.Context, out []OrderResponse, src []Order, ids []uuid.UUID) {
	info, err := h.svc.CourierInfoFor(ctx, ids)
	if err != nil {
		return
	}
	for i := range out {
		out[i].applyCourierDisplay(info[out[i].ID], src[i].CourierID)
	}
}

func (h *Handler) CreateOrder(c *gin.Context) {
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	o, err := h.svc.Create(c.Request.Context(), claims.UserID, claims.Role, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToOrderResponse(o))
}

// Stats handles GET /orders/stats?from=&to= — order-health breakdown for the
// owner dashboard. from/to are optional YYYY-MM-DD (local day) bounds.
func (h *Handler) Stats(c *gin.Context) {
	from, err := parseDayStart(c.Query("from"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid from date"))
		return
	}
	to, err := parseDayEnd(c.Query("to"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid to date"))
		return
	}
	stats, err := h.svc.Stats(c.Request.Context(), from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, stats)
}

func (h *Handler) GetOrder(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	o, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := []OrderResponse{ToOrderResponse(o)}
	h.enrichCourierDisplay(c.Request.Context(), out, []Order{*o}, []uuid.UUID{o.ID})
	response.OK(c, out[0])
}

func (h *Handler) UpdateOrder(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	o, err := h.svc.Update(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToOrderResponse(o))
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

func (h *Handler) GetTimeline(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	entries, err := h.svc.GetTimeline(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]TimelineResponse, 0, len(entries))
	for i := range entries {
		out = append(out, ToTimelineResponse(&entries[i]))
	}
	response.OK(c, out)
}

// ─── Status ───────────────────────────────────────────────────────────────────

func (h *Handler) ChangeStatus(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req ChangeStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	o, err := h.svc.ChangeStatus(c.Request.Context(), claims.UserID, claims.Role, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToOrderResponse(o))
}

// ─── Prepayments ──────────────────────────────────────────────────────────────

func (h *Handler) AddPrepayment(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req AddPrepaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	p, err := h.svc.AddPrepayment(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToPrepaymentResponse(p))
}

func (h *Handler) ListPrepayments(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	preps, err := h.svc.ListPrepayments(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]PrepaymentResponse, 0, len(preps))
	for i := range preps {
		out = append(out, ToPrepaymentResponse(&preps[i]))
	}
	response.OK(c, out)
}

// VerifyPrepayment handles POST /orders/:id/prepayment/verify
func (h *Handler) VerifyPrepayment(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	var req VerifyPrepaymentRequest
	// optional body — ignore bind error
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.VerifyPrepayment(c.Request.Context(), claims.UserID, claims.Role, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToOrderResponse(o))
}

// RejectPrepayment handles POST /orders/:id/prepayment/reject
func (h *Handler) RejectPrepayment(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	var req RejectPrepaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	o, err := h.svc.RejectPrepayment(c.Request.Context(), claims.UserID, claims.Role, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToOrderResponse(o))
}

// ListAttachments handles GET /orders/:id/attachments
func (h *Handler) ListAttachments(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	atts, err := h.svc.ListAttachments(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]AttachmentResponse, 0, len(atts))
	for i := range atts {
		a := &atts[i]
		out = append(out, AttachmentResponse{
			ID:         a.ID,
			OrderID:    a.OrderID,
			Type:       a.Type,
			FileURL:    a.FileURL,
			UploadedBy: a.UploadedBy,
			CreatedAt:  a.CreatedAt,
		})
	}
	response.OK(c, out)
}

// AddAttachment handles POST /orders/:id/attachments
func (h *Handler) AddAttachment(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	var body struct {
		Type    string `json:"type"     binding:"required"`
		FileURL string `json:"file_url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(body); appErr != nil {
		response.Error(c, appErr)
		return
	}
	att, err := h.svc.AddAttachment(c.Request.Context(), claims.UserID, id, body.Type, body.FileURL)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, AttachmentResponse{
		ID:         att.ID,
		OrderID:    att.OrderID,
		Type:       att.Type,
		FileURL:    att.FileURL,
		UploadedBy: att.UploadedBy,
		CreatedAt:  att.CreatedAt,
	})
}

// GetSnapshot handles GET /orders/:id/snapshot — Phase 6.
// Returns the frozen financial snapshot rates for an order.
func (h *Handler) GetSnapshot(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	snap, err := h.svc.GetSnapshot(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, snap)
}

// ─── Order Comments ───────────────────────────────────────────────────────────

// GetOrderComments handles GET /orders/:id/comments.
func (h *Handler) GetOrderComments(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	comments, err := h.svc.GetOrderComments(c.Request.Context(), id, claims.UserID, claims.Role)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, comments)
}

// AddOrderComment handles POST /orders/:id/comments.
func (h *Handler) AddOrderComment(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req AddOrderCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	comment, err := h.svc.AddOrderComment(c.Request.Context(), id, claims.UserID, claims.Role, req.Comment)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, comment)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid "+param+": must be a UUID"))
		c.Abort()
		return uuid.Nil, false
	}
	return id, true
}
