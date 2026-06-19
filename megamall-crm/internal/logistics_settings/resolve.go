package logistics_settings

import (
	"fmt"

	"github.com/google/uuid"
	courier_tariffs "github.com/megamall/crm/internal/courier_tariffs"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

// ResolveCourierPayout returns the payout owed to a courier for delivering one
// order of the given delivery_method and order total amount.
//
// Resolution order (highest priority first):
//  1. courier_tariff_rules — range-based rules configured per courier.
//     The first matching bracket (by amount_from/amount_to) wins.
//  2. courier_profiles.payout_normal / payout_fast — flat fallback.
//
// method "fast" or "express" → uses "fast" tariff rules / payout_fast.
// Anything else              → uses "normal" tariff rules / payout_normal.
func ResolveCourierPayout(db *gorm.DB, courierID uuid.UUID, method string, orderAmount float64) (float64, error) {
	deliveryType := courier_tariffs.DeliveryNormal
	if method == "fast" || method == "express" {
		deliveryType = courier_tariffs.DeliveryFast
	}

	// 1. Try range-based tariff rules first.
	tariffRepo := courier_tariffs.NewRepository(db)
	payout, err := tariffRepo.ResolveForOrder(db, courierID, deliveryType, orderAmount)
	if err != nil {
		return 0, fmt.Errorf("resolve courier tariff rules: %w", err)
	}
	if payout > 0 {
		return payout, nil
	}

	// 2. Fall back to flat profile rate.
	var p CourierProfile
	if err := db.First(&p, "user_id = ?", courierID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, nil
		}
		return 0, fmt.Errorf("resolve courier payout profile: %w", err)
	}
	if deliveryType == courier_tariffs.DeliveryFast {
		return p.PayoutFast, nil
	}
	return p.PayoutNormal, nil
}

// CourierProfileStatus reports whether the courier has a payout profile row and
// whether it is active. Assignment/claim flows must reject couriers that have no
// profile (payout not configured) or whose profile is inactive.
func CourierProfileStatus(db *gorm.DB, courierID uuid.UUID) (exists bool, active bool, err error) {
	var p CourierProfile
	e := db.First(&p, "user_id = ?", courierID).Error
	if e != nil {
		if e == gorm.ErrRecordNotFound {
			return false, false, nil
		}
		return false, false, fmt.Errorf("courier profile status: %w", e)
	}
	return true, p.IsActive, nil
}

// ResolveAssignmentPayout enforces the courier assignment rules and returns the
// payout to freeze onto the order. It is the single guard used by every
// assignment/claim path (dispatcher assign, reassign, courier self-claim):
//
//   - courier must have a payout profile (else: configure in HR first)
//   - profile must be active (else: courier inactive)
//   - courier must serve the order's city (skipped when cityID is nil, e.g. legacy)
//
// Returns the resolved payout (normal/fast) on success.
func ResolveAssignmentPayout(db *gorm.DB, courierID uuid.UUID, cityID *uuid.UUID, method string) (float64, error) {
	// Guard 1: courier user account must be active (dispatcher toggle).
	var userActive bool
	if err := db.Raw("SELECT is_active FROM users WHERE id = ? AND deleted_at IS NULL", courierID).Scan(&userActive).Error; err != nil {
		return 0, apperrors.Internal(fmt.Errorf("check courier user active: %w", err))
	}
	if !userActive {
		return 0, apperrors.BadRequest("курьер отключён диспетчером")
	}

	// Guard 2: courier must have a payout profile with is_active=true.
	exists, active, err := CourierProfileStatus(db, courierID)
	if err != nil {
		return 0, apperrors.Internal(err)
	}
	if !exists {
		return 0, apperrors.BadRequest("у курьера не настроен тариф выплат — настройте его в разделе HR")
	}
	if !active {
		return 0, apperrors.BadRequest("курьер неактивен")
	}
	if cityID != nil {
		serves, err := CourierServesCity(db, courierID, *cityID)
		if err != nil {
			return 0, apperrors.Internal(err)
		}
		if !serves {
			return 0, apperrors.BadRequest("курьер не обслуживает город этого заказа")
		}
	}
	// At assignment time we do not yet know the order amount, so we pass 0.
	// The tariff resolver falls through to the flat profile rate when amount is 0.
	return ResolveCourierPayout(db, courierID, method, 0)
}

// CourierServesCity reports whether a courier is assigned to a given city.
// Used by Phase 4 to filter the courier app feed.
func CourierServesCity(db *gorm.DB, courierID, cityID uuid.UUID) (bool, error) {
	var count int64
	err := db.Model(&CourierCity{}).
		Where("courier_id = ? AND city_id = ?", courierID, cityID).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check courier city: %w", err)
	}
	return count > 0, nil
}
