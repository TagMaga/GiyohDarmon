package inventory

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the inventory service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Inventory reads ──────────────────────────────────────────────────────────

func (h *Handler) ListInventory(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	var f ListInventoryFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	rows, total, err := h.svc.ListInventory(c.Request.Context(), f, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]InventoryResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToInventoryResponse(&rows[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) GetInventoryByProduct(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	p := pagination.ParseFromQuery(c)
	rows, total, err := h.svc.GetByProduct(c.Request.Context(), id, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]InventoryResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToInventoryResponse(&rows[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) ListMovements(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	var f ListMovementsFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	rows, total, err := h.svc.ListMovements(c.Request.Context(), f, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]MovementResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToMovementResponse(&rows[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) SalesByProductReport(c *gin.Context) {
	var f ListProductSalesFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	rows, err := h.svc.SalesByProduct(c.Request.Context(), f)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]ProductSalesReportResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToProductSalesReportResponse(&rows[i]))
	}
	response.OK(c, out)
}

// ─── Receiving ────────────────────────────────────────────────────────────────

func (h *Handler) CreateReceiving(c *gin.Context) {
	var req CreateReceivingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	result, err := h.svc.Receive(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, result)
}

func (h *Handler) UpdateReceiving(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateReceivingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	result, err := h.svc.UpdateReceiving(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *Handler) ListReceivingHistory(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	rows, err := h.svc.ListReceivingEdits(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]ReceivingEditResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToReceivingEditResponse(&rows[i]))
	}
	response.OK(c, out)
}

// ─── Batches ──────────────────────────────────────────────────────────────────

func (h *Handler) ListBatches(c *gin.Context) {
	var f BatchListFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	onlyActive := c.Query("only_active") != "false"
	batches, err := h.svc.ListBatches(c.Request.Context(), f, onlyActive)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]BatchResponse, 0, len(batches))
	for _, b := range batches {
		out = append(out, ToBatchResponse(b))
	}
	response.OK(c, out)
}

func (h *Handler) InventoryIntegrityCheck(c *gin.Context) {
	rows, err := h.svc.InventoryIntegrityCheck(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rows)
}

// ─── Mutations ────────────────────────────────────────────────────────────────

func (h *Handler) CreateAdjustment(c *gin.Context) {
	var req CreateAdjustmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	adj, err := h.svc.Adjust(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToAdjustmentResponse(adj))
}

func (h *Handler) CreateWriteoff(c *gin.Context) {
	var req CreateWriteoffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	wo, err := h.svc.Writeoff(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToWriteoffResponse(wo))
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
