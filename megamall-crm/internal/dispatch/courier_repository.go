package dispatch

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
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
	return &CourierProfileResponse{
		CourierID:      u.ID,
		FullName:       u.FullName,
		Surname:        u.Surname,
		Phone:          u.Phone,
		TelegramChatID: u.TelegramChatID,
		IsActive:       u.IsActive,
	}, nil
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
