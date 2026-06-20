package dispatch

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/orders"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler serves dispatcher-facing routes.
// courierSvc is injected so dispatcher can confirm/reject courier cash handovers.
// tariffSvc is injected for per-courier tariff CRUD.
type Handler struct {
	svc        *Service
	courierSvc *courier.Service
}

func NewHandler(svc *Service, courierSvc *courier.Service) *Handler {
	return &Handler{svc: svc, courierSvc: courierSvc}
}

// ─── Board ────────────────────────────────────────────────────────────────────

func (h *Handler) getBoard(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	board, total, err := h.svc.GetBoard(c.Request.Context(), p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, board, pagination.BuildMeta(p, total))
}

func (h *Handler) getCouriersOverview(c *gin.Context) {
	overview, err := h.svc.GetCouriersOverview(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, overview)
}

func (h *Handler) updateCourierOrderIntake(c *gin.Context) {
	courierID, err := parseCourierID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req UpdateCourierOrderIntakeRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if req.Enabled == nil {
		response.HandleError(c, apperrors.BadRequest("enabled is required"))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	updated, svcErr := h.svc.UpdateCourierOrderIntake(c.Request.Context(), claims.UserID, courierID, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, updated)
}

func (h *Handler) getCashSettlement(c *gin.Context) {
	filter, err := parseCashSettlementFilter(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	rows, svcErr := h.svc.GetCashSettlement(c.Request.Context(), filter)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, rows)
}

func (h *Handler) listCashTransactions(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	filter, err := parseCashTransactionFilter(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	rows, total, svcErr := h.svc.ListCashTransactions(c.Request.Context(), filter, p)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) listOrderHistory(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	filter, err := parseOrderHistoryFilter(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	rows, total, svcErr := h.svc.ListOrderHistory(c.Request.Context(), filter, p)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	totalIncome, deliveredCount, svcErr := h.svc.AggregateOrderHistory(c.Request.Context(), filter)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	base := pagination.BuildMeta(p, total)
	type historyMeta struct {
		Page           int     `json:"page"`
		Limit          int     `json:"limit"`
		Total          int     `json:"total"`
		TotalPages     int     `json:"total_pages"`
		TotalIncome    float64 `json:"total_income"`
		DeliveredCount int     `json:"delivered_count"`
	}
	response.OKWithMeta(c, rows, historyMeta{
		Page:           base.Page,
		Limit:          base.Limit,
		Total:          base.Total,
		TotalPages:     base.TotalPages,
		TotalIncome:    totalIncome,
		DeliveredCount: deliveredCount,
	})
}

// ─── Order actions ────────────────────────────────────────────────────────────

func (h *Handler) confirmOrder(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req) // comment is optional
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.ConfirmOrder(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) assignCourier(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AssignCourierRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	assignment, svcErr := h.svc.AssignCourier(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.Created(c, AssignmentToResponse(assignment))
}

func (h *Handler) reassignCourier(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AssignCourierRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	assignment, svcErr := h.svc.ReassignCourier(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, AssignmentToResponse(assignment))
}

func (h *Handler) unassignCourier(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.UnassignCourier(c.Request.Context(), claims.UserID, id)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) scheduleOrder(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req ScheduleOrderRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if svcErr := h.svc.ScheduleOrder(c.Request.Context(), claims.UserID, id, req); svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.NoContent(c)
}

func (h *Handler) issueOrder(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.IssueOrder(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) resolveIssue(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req ResolveIssueRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.ResolveIssue(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) returnOrder(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.ReturnOrder(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

func (h *Handler) cancelOrder(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req StatusChangeRequest
	_ = c.ShouldBindJSON(&req)
	claims := middleware.ClaimsFromContext(c)
	order, svcErr := h.svc.CancelOrder(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, order)
}

// ─── Comments ─────────────────────────────────────────────────────────────────

func (h *Handler) listComments(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	// Dispatchers see all visibilities (nil = no filter).
	comments, svcErr := h.svc.ListComments(c.Request.Context(), id, nil)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	out := make([]CommentResponse, 0, len(comments))
	for i := range comments {
		out = append(out, CommentToResponse(&comments[i]))
	}
	response.OK(c, out)
}

func (h *Handler) addComment(c *gin.Context) {
	id, err := parseOrderID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req AddCommentRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	comment, svcErr := h.svc.AddComment(c.Request.Context(), claims.UserID, id, req)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.Created(c, CommentToResponse(comment))
}

// ─── Cash Handovers (dispatcher view — delegates to courier service) ──────────

func (h *Handler) listHandovers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	handovers, total, err := h.courierSvc.ListAllHandovers(c.Request.Context(), p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, handovers, pagination.BuildMeta(p, total))
}

func (h *Handler) confirmHandover(c *gin.Context) {
	id, err := parseHandoverID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req ConfirmHandoverRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	handover, svcErr := h.courierSvc.ConfirmHandover(c.Request.Context(), claims.UserID, id, courier.ConfirmHandoverRequest{
		ActualReturned: req.ActualReturned,
		Comment:        req.Comment,
	})
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, courier.HandoverToResponse(handover))
}

func (h *Handler) rejectHandover(c *gin.Context) {
	id, err := parseHandoverID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req RejectHandoverRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	handover, svcErr := h.courierSvc.RejectHandover(c.Request.Context(), claims.UserID, id, courier.RejectHandoverRequest{
		Comment: req.Comment,
	})
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, courier.HandoverToResponse(handover))
}

func (h *Handler) confirmCashTransaction(c *gin.Context) {
	id, err := parseHandoverID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	handover, svcErr := h.courierSvc.ConfirmTransaction(c.Request.Context(), claims.UserID, id)
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, courier.HandoverToResponse(handover))
}

func (h *Handler) rejectCashTransaction(c *gin.Context) {
	id, err := parseHandoverID(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	var req RejectCashTransactionRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		response.HandleError(c, apperrors.BadRequest("invalid request body"))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.HandleError(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	handover, svcErr := h.courierSvc.RejectHandover(c.Request.Context(), claims.UserID, id, courier.RejectHandoverRequest{
		Comment: req.Reason,
	})
	if svcErr != nil {
		response.HandleError(c, svcErr)
		return
	}
	response.OK(c, courier.HandoverToResponse(handover))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseOrderID(c *gin.Context) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, apperrors.BadRequest("invalid order id")
	}
	return id, nil
}

func parseCourierID(c *gin.Context) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, apperrors.BadRequest("invalid courier id")
	}
	return id, nil
}

func parseHandoverID(c *gin.Context) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, apperrors.BadRequest("invalid handover id")
	}
	return id, nil
}

func parseCashSettlementFilter(c *gin.Context) (CashSettlementFilter, error) {
	var filter CashSettlementFilter

	if fromRaw := c.Query("from"); fromRaw != "" {
		from, err := parseSettlementTime(fromRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid from date")
		}
		filter.From = &from
	}
	if toRaw := c.Query("to"); toRaw != "" {
		to, err := parseSettlementTime(toRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid to date")
		}
		filter.To = &to
	}
	if filter.From != nil && filter.To != nil && filter.From.After(*filter.To) {
		return filter, apperrors.BadRequest("from must be before to")
	}

	if courierRaw := c.Query("courier_id"); courierRaw != "" {
		courierID, err := uuid.Parse(courierRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid courier_id")
		}
		filter.CourierID = &courierID
	}

	return filter, nil
}

func parseCashTransactionFilter(c *gin.Context) (CashTransactionFilter, error) {
	var filter CashTransactionFilter
	if err := applyDateRange(c, &filter.From, &filter.To); err != nil {
		return filter, err
	}
	if courierRaw := c.Query("courier_id"); courierRaw != "" {
		courierID, err := uuid.Parse(courierRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid courier_id")
		}
		filter.CourierID = &courierID
	}
	if status := c.Query("status"); status != "" && status != "all" {
		switch courier.HandoverStatus(status) {
		case courier.HandoverStatusPending, courier.HandoverStatusConfirmed, courier.HandoverStatusRejected:
			filter.Status = status
		default:
			return filter, apperrors.BadRequest("invalid status")
		}
	}
	return filter, nil
}

func parseOrderHistoryFilter(c *gin.Context) (OrderHistoryFilter, error) {
	var filter OrderHistoryFilter
	if err := applyDateRange(c, &filter.From, &filter.To); err != nil {
		return filter, err
	}
	if courierRaw := c.Query("courier_id"); courierRaw != "" {
		courierID, err := uuid.Parse(courierRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid courier_id")
		}
		filter.CourierID = &courierID
	}
	if sellerRaw := c.Query("seller_id"); sellerRaw != "" {
		sellerID, err := uuid.Parse(sellerRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid seller_id")
		}
		filter.SellerID = &sellerID
	}
	if productRaw := c.Query("product_id"); productRaw != "" {
		productID, err := uuid.Parse(productRaw)
		if err != nil {
			return filter, apperrors.BadRequest("invalid product_id")
		}
		filter.ProductID = &productID
	}
	if status := c.Query("status"); status != "" && status != "all" {
		orderStatus := orders.OrderStatus(status)
		if !orderStatus.IsValid() {
			return filter, apperrors.BadRequest("invalid status")
		}
		filter.Status = orderStatus
	}
	filter.Product = c.Query("product")
	filter.Seller = c.Query("seller")
	filter.Search = c.Query("search")
	return filter, nil
}

func applyDateRange(c *gin.Context, from, to **time.Time) error {
	if fromRaw := c.Query("from"); fromRaw != "" {
		parsed, err := parseSettlementTime(fromRaw)
		if err != nil {
			return apperrors.BadRequest("invalid from date")
		}
		*from = &parsed
	}
	if toRaw := c.Query("to"); toRaw != "" {
		parsed, err := parseSettlementTime(toRaw)
		if err != nil {
			return apperrors.BadRequest("invalid to date")
		}
		*to = &parsed
	}
	if *from != nil && *to != nil {
		fromValue := *from
		toValue := *to
		if fromValue.After(*toValue) {
			return apperrors.BadRequest("from must be before to")
		}
	}
	return nil
}

func parseSettlementTime(raw string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, apperrors.BadRequest("invalid date")
}
