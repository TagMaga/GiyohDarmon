package notifications

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
)

// Handler wires HTTP routes to the notifications service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	p := pagination.ParseFromQuery(c)
	rows, total, err := h.svc.ListForUser(c.Request.Context(), claims.UserID, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]NotificationResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToResponse(&rows[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) UnreadCount(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	count, err := h.svc.UnreadCount(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, UnreadCountResponse{Count: count})
}

func (h *Handler) MarkRead(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid id: must be a UUID"))
		return
	}
	if err := h.svc.MarkRead(c.Request.Context(), claims.UserID, id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *Handler) MarkAllRead(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.MarkAllRead(c.Request.Context(), claims.UserID); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}
