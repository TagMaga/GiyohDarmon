package pharmacies

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

type Handler struct {
	svc *Service
	loc *time.Location
}

// NewHandler creates a pharmacies Handler. loc controls how bare YYYY-MM-DD
// from/to params are interpreted, as local midnight.
func NewHandler(svc *Service, loc *time.Location) *Handler {
	if loc == nil {
		loc = time.UTC
	}
	return &Handler{svc: svc, loc: loc}
}

func actorFrom(c *gin.Context) Actor {
	claims := middleware.ClaimsFromContext(c)
	return Actor{ID: claims.UserID, Role: claims.Role}
}

func idParam(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid id"))
		return uuid.Nil, false
	}
	return id, true
}

func bind[T any](c *gin.Context) (T, bool) {
	var req T
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return req, false
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return req, false
	}
	return req, true
}

func (h *Handler) List(c *gin.Context) {
	rows, err := h.svc.List(c.Request.Context(), actorFrom(c), c.Query("include_archived") == "true")
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, rows)
}

func (h *Handler) Dashboard(c *gin.Context) {
	now := time.Now().In(h.loc)
	from := now.AddDate(0, 0, -30)
	if v := c.Query("from"); v != "" {
		if parsed, err := time.ParseInLocation("2006-01-02", v, h.loc); err == nil {
			from = parsed
		}
	}
	to := now
	if v := c.Query("to"); v != "" {
		if parsed, err := time.ParseInLocation("2006-01-02", v, h.loc); err == nil {
			to = parsed.Add(24*time.Hour - time.Nanosecond)
		}
	}
	out, err := h.svc.Dashboard(c.Request.Context(), actorFrom(c), from, to)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

func (h *Handler) Detail(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	out, err := h.svc.Detail(c.Request.Context(), actorFrom(c), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

func (h *Handler) Create(c *gin.Context) {
	req, ok := bind[CreatePharmacyRequest](c)
	if !ok {
		return
	}
	out, err := h.svc.Create(c.Request.Context(), actorFrom(c), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, out)
}

func (h *Handler) Update(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[UpdatePharmacyRequest](c)
	if !ok {
		return
	}
	out, err := h.svc.Update(c.Request.Context(), actorFrom(c), id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, out)
}

func (h *Handler) TransferResponsibility(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[TransferResponsibilityRequest](c)
	if !ok {
		return
	}
	if err := h.svc.TransferResponsibility(c.Request.Context(), actorFrom(c), id, req); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"transferred": true})
}

func (h *Handler) Archive(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := h.svc.Archive(c.Request.Context(), actorFrom(c), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"archived": true})
}

func (h *Handler) CreateInvoice(c *gin.Context) {
	req, ok := bind[CreateInvoiceRequest](c)
	if !ok {
		return
	}
	out, err := h.svc.CreateInvoice(c.Request.Context(), actorFrom(c), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, out)
}

func (h *Handler) AcceptInvoice(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := h.svc.DecideInvoice(c.Request.Context(), actorFrom(c), id, true, ""); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"status": "accepted"})
}

func (h *Handler) RejectInvoice(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[RejectRequest](c)
	if !ok {
		return
	}
	if err := h.svc.DecideInvoice(c.Request.Context(), actorFrom(c), id, false, req.Reason); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"status": "rejected"})
}

func (h *Handler) CreatePayment(c *gin.Context) {
	req, ok := bind[CreatePaymentRequest](c)
	if !ok {
		return
	}
	out, err := h.svc.CreatePayment(c.Request.Context(), actorFrom(c), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, out)
}

func (h *Handler) ConfirmPayment(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := h.svc.ConfirmPayment(c.Request.Context(), actorFrom(c), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"status": "confirmed"})
}

func (h *Handler) RejectPayment(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[RejectRequest](c)
	if !ok {
		return
	}
	if err := h.svc.RejectPayment(c.Request.Context(), actorFrom(c), id, req.Reason); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"status": "rejected"})
}

func (h *Handler) CorrectPayment(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[CorrectPaymentRequest](c)
	if !ok {
		return
	}
	if err := h.svc.CorrectPayment(c.Request.Context(), actorFrom(c), id, req); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"corrected": true})
}

func (h *Handler) CreateReturn(c *gin.Context) {
	req, ok := bind[CreateReturnRequest](c)
	if !ok {
		return
	}
	out, err := h.svc.CreateReturn(c.Request.Context(), actorFrom(c), req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, out)
}

func (h *Handler) ProcessReturn(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	req, ok := bind[ProcessReturnRequest](c)
	if !ok {
		return
	}
	if err := h.svc.ProcessReturn(c.Request.Context(), actorFrom(c), id, req); err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"processed": true})
}
