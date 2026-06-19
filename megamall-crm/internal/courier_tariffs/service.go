package courier_tariffs

import (
	"context"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) ListByCourier(ctx context.Context, courierID uuid.UUID) ([]TariffRuleResponse, error) {
	rules, err := s.repo.ListByCourier(ctx, courierID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	out := make([]TariffRuleResponse, len(rules))
	for i := range rules {
		out[i] = ToResponse(&rules[i])
	}
	return out, nil
}

// rangesOverlap returns true when [aFrom, aTo) and [bFrom, bTo) share any point.
// nil means +infinity.
func rangesOverlap(aFrom float64, aTo *float64, bFrom float64, bTo *float64) bool {
	// A ends before B starts → no overlap
	if aTo != nil && *aTo <= bFrom {
		return false
	}
	// B ends before A starts → no overlap
	if bTo != nil && *bTo <= aFrom {
		return false
	}
	return true
}

func (s *Service) Create(ctx context.Context, courierID uuid.UUID, req CreateTariffRuleRequest) (TariffRuleResponse, error) {
	if req.AmountTo != nil && *req.AmountTo <= req.AmountFrom {
		return TariffRuleResponse{}, apperrors.BadRequest("amount_to must be greater than amount_from")
	}

	// Overlap check: load existing rules for this courier+delivery_type.
	existing, err := s.repo.ListByType(ctx, courierID, req.DeliveryType)
	if err != nil {
		return TariffRuleResponse{}, apperrors.Internal(err)
	}
	for i := range existing {
		if rangesOverlap(req.AmountFrom, req.AmountTo, existing[i].AmountFrom, existing[i].AmountTo) {
			return TariffRuleResponse{}, apperrors.Conflict("Тарифный диапазон пересекается с уже существующим тарифом")
		}
	}

	rule := &CourierTariffRule{
		ID:           uuid.New(),
		CourierID:    courierID,
		DeliveryType: req.DeliveryType,
		AmountFrom:   req.AmountFrom,
		AmountTo:     req.AmountTo,
		TariffType:   req.TariffType,
		TariffValue:  req.TariffValue,
	}
	if err := s.repo.Create(ctx, rule); err != nil {
		return TariffRuleResponse{}, apperrors.Internal(err)
	}
	return ToResponse(rule), nil
}

func (s *Service) Delete(ctx context.Context, ruleID, courierID uuid.UUID) error {
	if err := s.repo.Delete(ctx, ruleID, courierID); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}
