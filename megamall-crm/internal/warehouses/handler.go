package warehouses

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

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid "+param+": must be a UUID"))
		c.Abort()
		return uuid.Nil, false
	}
	return id, true
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

func (h *Handler) ListCouriers(c *gin.Context) {
	rows, err := h.svc.ListCouriers(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rows)
}

func (h *Handler) InventorySummary(c *gin.Context) {
	s, err := h.svc.GetInventorySummary(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, s)
}

func (h *Handler) InventoryDistribution(c *gin.Context) {
	distribution, err := h.svc.GetInventoryDistribution(c.Request.Context())
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, distribution)
}

func (h *Handler) ListWarehouses(c *gin.Context) {
	rows, err := h.svc.ListWarehouses(c.Request.Context(), c.Query("type"))
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rows)
}

func (h *Handler) CreateWarehouse(c *gin.Context) {
	var req CreateWarehouseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	w, err := h.svc.CreateWarehouse(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, w)
}

func (h *Handler) UpdateWarehouseName(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateWarehouseNameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	w, err := h.svc.UpdateWarehouseName(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, w)
}

// ─── Transfers ────────────────────────────────────────────────────────────────

func (h *Handler) CreateTransfer(c *gin.Context) {
	var req CreateTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	t, err := h.svc.CreateTransfer(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, t)
}

func (h *Handler) ListTransfers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	var f ListTransfersFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	rows, total, err := h.svc.ListTransfers(c.Request.Context(), f, nil, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) GetTransfer(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	t, err := h.svc.GetTransfer(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, t)
}

// ─── Returns / lost reports (owner / warehouse_manager side) ─────────────────

func (h *Handler) ListReturns(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	rows, total, err := h.svc.ListReturns(c.Request.Context(), c.Query("status"), p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) AcceptReturn(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.AcceptReturn(c.Request.Context(), claims.UserID, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, r)
}

func (h *Handler) RejectReturn(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.RejectReturn(c.Request.Context(), claims.UserID, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, r)
}

func (h *Handler) ListLostReports(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	rows, total, err := h.svc.ListLostReports(c.Request.Context(), c.Query("status"), nil, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) DecideLostReport(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req DecideLostReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.DecideLostReport(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, r)
}

// ─── Courier-side (My Warehouse) ──────────────────────────────────────────────

func (h *Handler) MyWarehouse(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.MyWarehouse(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, r)
}

func (h *Handler) MyTransfers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	var f ListTransfersFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	rows, total, err := h.svc.ListTransfers(c.Request.Context(), f, &claims.UserID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}

func (h *Handler) AcceptTransfer(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	t, err := h.svc.AcceptTransfer(c.Request.Context(), claims.UserID, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, t)
}

func (h *Handler) RejectTransfer(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	t, err := h.svc.RejectTransfer(c.Request.Context(), claims.UserID, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, t)
}

func (h *Handler) CreateReturn(c *gin.Context) {
	var req CreateReturnRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.CreateFullReturn(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, r)
}

func (h *Handler) CreateLostReport(c *gin.Context) {
	var req CreateLostReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	r, err := h.svc.CreateLostReport(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, r)
}

func (h *Handler) MyLostReports(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	claims := middleware.ClaimsFromContext(c)
	rows, total, err := h.svc.ListLostReports(c.Request.Context(), c.Query("status"), &claims.UserID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(p, total))
}
