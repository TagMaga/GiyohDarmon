// Package courier_tariffs manages per-courier range-based payout tariff rules.
// Rules are matched by order total_amount and delivery_type at delivery time.
// They extend (and take priority over) the flat payout in courier_profiles.
package courier_tariffs

import (
	"time"

	"github.com/google/uuid"
)

// DeliveryType mirrors orders.DeliveryMethod values.
type DeliveryType string

const (
	DeliveryNormal DeliveryType = "normal"
	DeliveryFast   DeliveryType = "fast"
)

// TariffType determines how the payout is calculated.
type TariffType string

const (
	TariffFixed   TariffType = "fixed"   // flat amount in TJS
	TariffPercent TariffType = "percent" // percentage of order total_amount
)

// CourierTariffRule is one bracket in a courier's payout schedule.
type CourierTariffRule struct {
	ID           uuid.UUID    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	CourierID    uuid.UUID    `gorm:"type:uuid;not null;column:courier_id"`
	DeliveryType DeliveryType `gorm:"column:delivery_type;not null"`
	AmountFrom   float64      `gorm:"column:amount_from;not null;default:0"`
	AmountTo     *float64     `gorm:"column:amount_to"` // nil = no upper bound
	TariffType   TariffType   `gorm:"column:tariff_type;not null"`
	TariffValue  float64      `gorm:"column:tariff_value;not null"`
	CreatedAt    time.Time    `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time    `gorm:"column:updated_at;autoUpdateTime"`
}

func (CourierTariffRule) TableName() string { return "courier_tariff_rules" }

// Resolve computes the payout for an order of the given total amount.
// Returns 0 if the amount does not fall within this rule's bracket.
func (r *CourierTariffRule) Resolve(orderAmount float64) (float64, bool) {
	if orderAmount < r.AmountFrom {
		return 0, false
	}
	if r.AmountTo != nil && orderAmount >= *r.AmountTo {
		return 0, false
	}
	switch r.TariffType {
	case TariffFixed:
		return r.TariffValue, true
	case TariffPercent:
		return orderAmount * r.TariffValue / 100, true
	}
	return 0, false
}
