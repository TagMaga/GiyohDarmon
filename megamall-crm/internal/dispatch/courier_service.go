package dispatch

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"golang.org/x/crypto/bcrypt"
)

// UpdateCourier edits a courier's profile fields: name, surname, phone (login),
// and password (optional).
// Does NOT touch financial records, debt, earnings, orders, or history.
func (s *Service) UpdateCourier(ctx context.Context, courierID uuid.UUID, req UpdateCourierRequest) (*CourierProfileResponse, error) {
	updates := map[string]interface{}{
		"full_name": strings.TrimSpace(req.FullName),
		"phone":     strings.TrimSpace(req.Phone),
	}

	if req.Surname != nil {
		v := strings.TrimSpace(*req.Surname)
		updates["surname"] = v
	}

	if req.Password != nil && strings.TrimSpace(*req.Password) != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
		}
		updates["password_hash"] = string(hash)
	}

	if _, err := s.repo.UpdateCourierProfile(ctx, courierID, updates); err != nil {
		return nil, err
	}

	if req.CityIDs != nil {
		if err := s.repo.setCourierCities(ctx, courierID, req.CityIDs); err != nil {
			return nil, fmt.Errorf("update courier cities: %w", err)
		}
	}

	// Reload to include city IDs in the response.
	updated, err := s.repo.getCourierProfileResponse(ctx, courierID)
	if err != nil {
		return nil, err
	}

	s.logger.LogAsync(activity.Entry{
		Action:     "update_courier",
		EntityType: "courier",
		EntityID:   &courierID,
		AfterState: map[string]interface{}{"full_name": updated.FullName, "phone": updated.Phone},
	})

	return updated, nil
}

// ToggleCourierActive sets the courier's is_active flag.
// When set to false: courier cannot accept new orders; existing assigned orders are untouched.
func (s *Service) ToggleCourierActive(ctx context.Context, courierID uuid.UUID, active bool) (*CourierProfileResponse, error) {
	updated, err := s.repo.SetCourierActive(ctx, courierID, active)
	if err != nil {
		return nil, err
	}

	action := "enable_courier"
	if !active {
		action = "disable_courier"
	}
	s.logger.LogAsync(activity.Entry{
		Action:     action,
		EntityType: "courier",
		EntityID:   &courierID,
		AfterState: map[string]interface{}{"is_active": active},
	})

	return updated, nil
}
