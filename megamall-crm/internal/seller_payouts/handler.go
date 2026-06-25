package seller_payouts

import (
	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
)

// Handler exposes seller payout endpoints.
type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// GetMyPayouts handles GET /seller-payouts/me.
// Returns the authenticated seller's payout history.
func (h *Handler) GetMyPayouts(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	payouts, err := h.repo.ListBySellerID(c.Request.Context(), claims.UserID)
	if err != nil {
		response.HandleError(c, apperrors.Internal(err))
		return
	}
	out := make([]SellerPayoutResponse, len(payouts))
	for i := range payouts {
		out[i] = ToResponse(&payouts[i])
	}
	response.OK(c, out)
}
