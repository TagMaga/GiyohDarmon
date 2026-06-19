package courier_tariffs

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// ListByCourier returns all tariff rules for a courier, sorted by delivery_type then amount_from.
func (r *Repository) ListByCourier(ctx context.Context, courierID uuid.UUID) ([]CourierTariffRule, error) {
	var rules []CourierTariffRule
	err := r.db.WithContext(ctx).
		Where("courier_id = ?", courierID).
		Order("delivery_type ASC, amount_from ASC").
		Find(&rules).Error
	if err != nil {
		return nil, fmt.Errorf("list courier tariff rules: %w", err)
	}
	return rules, nil
}

// ListByType returns rules for a specific courier + delivery type, sorted by amount_from.
func (r *Repository) ListByType(ctx context.Context, courierID uuid.UUID, dt DeliveryType) ([]CourierTariffRule, error) {
	var rules []CourierTariffRule
	err := r.db.WithContext(ctx).
		Where("courier_id = ? AND delivery_type = ?", courierID, dt).
		Order("amount_from ASC").
		Find(&rules).Error
	if err != nil {
		return nil, fmt.Errorf("list courier tariff rules by type: %w", err)
	}
	return rules, nil
}

// Create inserts a new tariff rule.
func (r *Repository) Create(ctx context.Context, rule *CourierTariffRule) error {
	if err := r.db.WithContext(ctx).Create(rule).Error; err != nil {
		return fmt.Errorf("create courier tariff rule: %w", err)
	}
	return nil
}

// Delete removes a tariff rule by id (must belong to the given courier for safety).
func (r *Repository) Delete(ctx context.Context, ruleID, courierID uuid.UUID) error {
	res := r.db.WithContext(ctx).
		Where("id = ? AND courier_id = ?", ruleID, courierID).
		Delete(&CourierTariffRule{})
	if res.Error != nil {
		return fmt.Errorf("delete courier tariff rule: %w", res.Error)
	}
	return nil
}

// ResolveForOrder finds the payout for a courier+deliveryType+orderAmount combination.
// Returns 0, nil when no matching rule exists (caller falls back to profile flat rate).
func (r *Repository) ResolveForOrder(db *gorm.DB, courierID uuid.UUID, deliveryType DeliveryType, orderAmount float64) (float64, error) {
	var rules []CourierTariffRule
	err := db.Where("courier_id = ? AND delivery_type = ?", courierID, deliveryType).
		Order("amount_from ASC").
		Find(&rules).Error
	if err != nil {
		return 0, fmt.Errorf("resolve courier tariff: %w", err)
	}
	for i := range rules {
		payout, matched := rules[i].Resolve(orderAmount)
		if matched {
			return payout, nil
		}
	}
	return 0, nil // no rule matched → caller uses flat profile rate
}
