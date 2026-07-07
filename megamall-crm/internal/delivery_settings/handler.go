package delivery_settings

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"gorm.io/gorm"
)

type Handler struct {
	db     *gorm.DB
	logger *activity.Logger
}

func NewHandler(db *gorm.DB, logger *activity.Logger) *Handler {
	return &Handler{db: db, logger: logger}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("", h.get)
	rg.PUT("", h.update)
}

func (h *Handler) get(c *gin.Context) {
	s, err := h.fetch(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, Response{NormalFee: s.NormalFee, FastFee: s.FastFee})
}

func (h *Handler) update(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)
	if claims.Role != "owner" {
		response.HandleError(c, apperrors.Forbidden("only owner can change delivery settings"))
		return
	}
	actorID := claims.UserID

	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest(err.Error()))
		return
	}
	if req.NormalFee < 0 || req.FastFee < 0 {
		response.HandleError(c, apperrors.BadRequest("fees must be >= 0"))
		return
	}

	before, err := h.fetch(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	updates := map[string]interface{}{
		"normal_fee": req.NormalFee,
		"fast_fee":   req.FastFee,
		"updated_by": actorID,
	}
	if err := h.db.WithContext(c).Table("delivery_settings").Where("id = 1").Updates(updates).Error; err != nil {
		response.HandleError(c, fmt.Errorf("update delivery settings: %w", err))
		return
	}

	s, err := h.fetch(c)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	// delivery_settings is a singleton row (id=1, not a uuid) — no EntityID to attach.
	h.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "update",
		EntityType:  "delivery_settings",
		BeforeState: Response{NormalFee: before.NormalFee, FastFee: before.FastFee},
		AfterState:  Response{NormalFee: s.NormalFee, FastFee: s.FastFee},
	})

	response.OK(c, Response{NormalFee: s.NormalFee, FastFee: s.FastFee})
}

func (h *Handler) fetch(c *gin.Context) (*Settings, error) {
	var s Settings
	if err := h.db.WithContext(c).First(&s, "id = 1").Error; err != nil {
		return nil, fmt.Errorf("get delivery settings: %w", err)
	}
	return &s, nil
}

// GetFee returns the CLIENT delivery fee for a given delivery_method string.
// Safe to call from other packages. This is the single source of truth for the
// client-facing delivery charge. Courier payout is resolved separately.
//
// Accepts both "fast" (canonical) and the legacy "express" alias → fast_fee.
func GetFee(db *gorm.DB, method string) (float64, error) {
	var s Settings
	if err := db.First(&s, "id = 1").Error; err != nil {
		return 0, fmt.Errorf("delivery settings: %w", err)
	}
	if method == "fast" || method == "express" {
		return s.FastFee, nil
	}
	return s.NormalFee, nil
}
