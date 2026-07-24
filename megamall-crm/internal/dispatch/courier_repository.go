package dispatch

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

// UpdateCourierProfile applies the given column updates to a courier user row.
// Returns the updated profile summary. Phone uniqueness is enforced by the DB index.
func (r *Repository) UpdateCourierProfile(ctx context.Context, courierID uuid.UUID, updates map[string]interface{}) (*CourierProfileResponse, error) {
	res := r.db.WithContext(ctx).Model(&users.User{}).
		Where("id = ? AND role = 'courier' AND deleted_at IS NULL", courierID).
		Updates(updates)
	if res.Error != nil {
		if isUniqueViolation(res.Error) {
			return nil, apperrors.Conflict("телефон уже используется другим пользователем")
		}
		return nil, fmt.Errorf("update courier profile: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return nil, apperrors.NotFound("courier")
	}
	return r.getCourierProfileResponse(ctx, courierID)
}

// SetCourierActive toggles the is_active field for a courier.
func (r *Repository) SetCourierActive(ctx context.Context, courierID uuid.UUID, active bool) (*CourierProfileResponse, error) {
	res := r.db.WithContext(ctx).Model(&users.User{}).
		Where("id = ? AND role = 'courier' AND deleted_at IS NULL", courierID).
		Update("is_active", active)
	if res.Error != nil {
		return nil, fmt.Errorf("set courier active: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return nil, apperrors.NotFound("courier")
	}
	return r.getCourierProfileResponse(ctx, courierID)
}

func (r *Repository) getCourierProfileResponse(ctx context.Context, courierID uuid.UUID) (*CourierProfileResponse, error) {
	var u users.User
	if err := r.db.WithContext(ctx).First(&u, "id = ? AND deleted_at IS NULL", courierID).Error; err != nil {
		return nil, fmt.Errorf("fetch updated courier: %w", err)
	}

	type cityLink struct {
		CityID uuid.UUID `gorm:"column:city_id"`
	}
	var links []cityLink
	r.db.WithContext(ctx).
		Table("courier_cities").
		Select("city_id").
		Where("courier_id = ?", courierID).
		Scan(&links)
	cityIDs := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		cityIDs = append(cityIDs, l.CityID)
	}

	return &CourierProfileResponse{
		CourierID:       u.ID,
		FullName:        u.FullName,
		Surname:         u.Surname,
		Phone:           u.Phone,
		IsActive:        u.IsActive,
		CityIDs:         cityIDs,
		MaxActiveOrders: u.CourierMaxActiveOrders,
	}, nil
}

// setCourierCities replaces a courier's city assignments atomically.
func (r *Repository) setCourierCities(ctx context.Context, courierID uuid.UUID, cityIDs []uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM courier_cities WHERE courier_id = ?", courierID).Error; err != nil {
			return fmt.Errorf("clear courier cities: %w", err)
		}
		for _, cid := range cityIDs {
			row := map[string]interface{}{"courier_id": courierID, "city_id": cid}
			if err := tx.Table("courier_cities").Create(&row).Error; err != nil {
				return fmt.Errorf("assign city %s: %w", cid, err)
			}
		}
		return nil
	})
}

// isUniqueViolation detects PostgreSQL unique constraint errors.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return containsCode(err.Error(), "23505") || containsCode(err.Error(), "duplicate key")
}

func containsCode(s, code string) bool {
	return len(s) >= len(code) && (s == code || len(s) > 0 && contains(s, code))
}

func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
