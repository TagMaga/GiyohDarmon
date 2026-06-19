package courier_tariffs

import (
	"time"

	"github.com/google/uuid"
)

// TariffRuleResponse is the API response for a single tariff rule.
type TariffRuleResponse struct {
	ID           uuid.UUID    `json:"id"`
	CourierID    uuid.UUID    `json:"courier_id"`
	DeliveryType DeliveryType `json:"delivery_type"`
	AmountFrom   float64      `json:"amount_from"`
	AmountTo     *float64     `json:"amount_to"`
	TariffType   TariffType   `json:"tariff_type"`
	TariffValue  float64      `json:"tariff_value"`
	CreatedAt    time.Time    `json:"created_at"`
}

func ToResponse(r *CourierTariffRule) TariffRuleResponse {
	return TariffRuleResponse{
		ID:           r.ID,
		CourierID:    r.CourierID,
		DeliveryType: r.DeliveryType,
		AmountFrom:   r.AmountFrom,
		AmountTo:     r.AmountTo,
		TariffType:   r.TariffType,
		TariffValue:  r.TariffValue,
		CreatedAt:    r.CreatedAt,
	}
}

// CreateTariffRuleRequest is the payload to create a new tariff rule.
type CreateTariffRuleRequest struct {
	DeliveryType DeliveryType `json:"delivery_type" validate:"required,oneof=normal fast"`
	AmountFrom   float64      `json:"amount_from"   validate:"min=0"`
	AmountTo     *float64     `json:"amount_to"`
	TariffType   TariffType   `json:"tariff_type"   validate:"required,oneof=fixed percent"`
	TariffValue  float64      `json:"tariff_value"  validate:"gt=0"`
}
