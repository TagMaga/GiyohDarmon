package health

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/response"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Health handles GET /api/v1/health — no auth required.
func (h *Handler) Health(c *gin.Context) {
	status := h.svc.Health(c.Request.Context())
	response.OK(c, status)
}

// Ready handles GET /api/v1/ready — no auth required.
// Returns 200 if ready=true, 503 if any check fails.
func (h *Handler) Ready(c *gin.Context) {
	status := h.svc.Ready(c.Request.Context())
	if status.Ready {
		response.OK(c, status)
	} else {
		c.JSON(http.StatusServiceUnavailable, response.Envelope{
			Success: false,
			Data:    status,
		})
	}
}
