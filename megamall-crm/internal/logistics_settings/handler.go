package logistics_settings

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"gorm.io/gorm"
)

type Handler struct {
	db *gorm.DB
}

func NewHandler(db *gorm.DB) *Handler {
	return &Handler{db: db}
}

// ─── Cities ─────────────────────────────────────────────────────────────────

func (h *Handler) listCities(c *gin.Context) {
	q := h.db.WithContext(c).Order("name ASC")
	// Owners may request inactive cities too; everyone else sees active only.
	role := middleware.ClaimsFromContext(c).Role
	if !(role == "owner" && c.Query("include_inactive") == "true") {
		q = q.Where("is_active = ?", true)
	}
	var rows []City
	if err := q.Find(&rows).Error; err != nil {
		response.HandleError(c, fmt.Errorf("list cities: %w", err))
		return
	}
	out := make([]CityResponse, 0, len(rows))
	for _, r := range rows {
		out = append(out, CityResponse{ID: r.ID, Name: r.Name, IsActive: r.IsActive})
	}
	response.OK(c, out)
}

func (h *Handler) createCity(c *gin.Context) {
	if !h.requireOwner(c) {
		return
	}
	var req CreateCityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest(err.Error()))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		response.HandleError(c, apperrors.BadRequest("name is required"))
		return
	}
	city := City{ID: uuid.New(), Name: req.Name, IsActive: true}
	if err := h.db.WithContext(c).Create(&city).Error; err != nil {
		response.HandleError(c, apperrors.Conflict("city already exists"))
		return
	}
	response.Created(c, CityResponse{ID: city.ID, Name: city.Name, IsActive: city.IsActive})
}

func (h *Handler) toggleCity(c *gin.Context) {
	if !h.requireOwner(c) {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid city id"))
		return
	}
	var req ToggleCityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest(err.Error()))
		return
	}
	res := h.db.WithContext(c).Model(&City{}).Where("id = ?", id).
		Update("is_active", req.IsActive)
	if res.Error != nil {
		response.HandleError(c, fmt.Errorf("toggle city: %w", res.Error))
		return
	}
	if res.RowsAffected == 0 {
		response.HandleError(c, apperrors.NotFound("city"))
		return
	}
	response.OK(c, gin.H{"id": id, "is_active": req.IsActive})
}

// ─── Courier payout profile ─────────────────────────────────────────────────

func (h *Handler) getCourierPayout(c *gin.Context) {
	if !h.requireOwner(c) {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid courier id"))
		return
	}
	if err := h.assertCourier(c, id); err != nil {
		response.HandleError(c, err)
		return
	}

	// Profile (auto-create a zero default if missing so the UI always has a shape).
	var p CourierProfile
	err = h.db.WithContext(c).First(&p, "user_id = ?", id).Error
	if err == gorm.ErrRecordNotFound {
		p = CourierProfile{UserID: id, IsActive: true}
		if cerr := h.db.WithContext(c).Create(&p).Error; cerr != nil {
			response.HandleError(c, fmt.Errorf("create courier profile: %w", cerr))
			return
		}
	} else if err != nil {
		response.HandleError(c, fmt.Errorf("get courier profile: %w", err))
		return
	}

	cityIDs, err := h.courierCityIDs(c, id)
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OK(c, CourierPayoutResponse{
		UserID:       p.UserID,
		PayoutNormal: p.PayoutNormal,
		PayoutFast:   p.PayoutFast,
		IsActive:     p.IsActive,
		CityIDs:      cityIDs,
	})
}

func (h *Handler) updateCourierPayout(c *gin.Context) {
	if !h.requireOwner(c) {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.HandleError(c, apperrors.BadRequest("invalid courier id"))
		return
	}
	if err := h.assertCourier(c, id); err != nil {
		response.HandleError(c, err)
		return
	}

	var req UpdateCourierPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.HandleError(c, apperrors.BadRequest(err.Error()))
		return
	}
	if req.PayoutNormal < 0 || req.PayoutFast < 0 {
		response.HandleError(c, apperrors.BadRequest("payout amounts must be >= 0"))
		return
	}

	err = h.db.WithContext(c).Transaction(func(tx *gorm.DB) error {
		// Upsert the profile.
		p := CourierProfile{
			UserID:       id,
			PayoutNormal: req.PayoutNormal,
			PayoutFast:   req.PayoutFast,
			IsActive:     req.IsActive,
		}
		if err := tx.Save(&p).Error; err != nil {
			return fmt.Errorf("save courier profile: %w", err)
		}

		// Replace city assignments.
		if err := tx.Where("courier_id = ?", id).Delete(&CourierCity{}).Error; err != nil {
			return fmt.Errorf("clear courier cities: %w", err)
		}
		if len(req.CityIDs) > 0 {
			links := make([]CourierCity, 0, len(req.CityIDs))
			for _, cid := range req.CityIDs {
				links = append(links, CourierCity{CourierID: id, CityID: cid})
			}
			if err := tx.Create(&links).Error; err != nil {
				return fmt.Errorf("assign courier cities: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		response.HandleError(c, err)
		return
	}

	response.OK(c, CourierPayoutResponse{
		UserID:       id,
		PayoutNormal: req.PayoutNormal,
		PayoutFast:   req.PayoutFast,
		IsActive:     req.IsActive,
		CityIDs:      req.CityIDs,
	})
}

// ─── helpers ────────────────────────────────────────────────────────────────

func (h *Handler) requireOwner(c *gin.Context) bool {
	if middleware.ClaimsFromContext(c).Role != "owner" {
		response.HandleError(c, apperrors.Forbidden("owner only"))
		return false
	}
	return true
}

// assertCourier verifies the user exists and has the courier role.
func (h *Handler) assertCourier(c *gin.Context, id uuid.UUID) error {
	var role string
	err := h.db.WithContext(c).Table("users").
		Select("role").Where("id = ?", id).Scan(&role).Error
	if err != nil {
		return fmt.Errorf("lookup user: %w", err)
	}
	if role == "" {
		return apperrors.NotFound("courier")
	}
	if role != "courier" {
		return apperrors.BadRequest("user is not a courier")
	}
	return nil
}

func (h *Handler) courierCityIDs(c *gin.Context, courierID uuid.UUID) ([]uuid.UUID, error) {
	var links []CourierCity
	if err := h.db.WithContext(c).
		Where("courier_id = ?", courierID).Find(&links).Error; err != nil {
		return nil, fmt.Errorf("list courier cities: %w", err)
	}
	ids := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.CityID)
	}
	return ids, nil
}
