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
// password (optional), and telegram_chat_id.
// Does NOT touch financial records, debt, earnings, orders, or history.
func (s *Service) UpdateCourier(ctx context.Context, courierID uuid.UUID, req UpdateCourierRequest) (*CourierProfileResponse, error) {
	// Validate telegram_chat_id is present
	if req.TelegramChatID == nil || strings.TrimSpace(*req.TelegramChatID) == "" {
		return nil, apperrors.BadRequest("telegram_chat_id is required")
	}

	updates := map[string]interface{}{
		"full_name":        strings.TrimSpace(req.FullName),
		"phone":            strings.TrimSpace(req.Phone),
		"telegram_chat_id": strings.TrimSpace(*req.TelegramChatID),
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

	updated, err := s.repo.UpdateCourierProfile(ctx, courierID, updates)
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
