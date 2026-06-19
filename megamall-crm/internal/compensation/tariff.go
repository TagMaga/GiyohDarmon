package compensation

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ResolvedTariff holds the delivery fee resolved from the active tariff.
type ResolvedTariff struct {
	TariffID   uuid.UUID
	TariffType TariffType
	Fee        float64
}

// TariffCalculator resolves the delivery fee for a given order total
// using the tariff active at a specific point in time.
type TariffCalculator struct {
	repo *Repository
}

// NewTariffCalculator creates a TariffCalculator backed by repo.
func NewTariffCalculator(repo *Repository) *TariffCalculator {
	return &TariffCalculator{repo: repo}
}

// ErrNoActiveTariff is returned when no tariff covers the requested timestamp.
var ErrNoActiveTariff = fmt.Errorf("no active delivery tariff configured")

// Resolve finds the delivery tariff active at `at` and computes the fee
// for the given orderTotal.
//
//   - For a fixed tariff, fee = tariff.FixedFee regardless of orderTotal.
//   - For a tiered tariff, fee is looked up in delivery_tariff_ranges by orderTotal.
//     If orderTotal does not fall in any range, returns ErrNoActiveTariff
//     (owner must ensure ranges cover the full expected range).
//
// Returns ErrNoActiveTariff if no tariff exists at `at`.
func (tc *TariffCalculator) Resolve(
	ctx context.Context,
	orderTotal float64,
	at time.Time,
) (*ResolvedTariff, error) {
	tariff, err := tc.repo.GetActiveTariffAtTime(ctx, at)
	if err != nil {
		return nil, fmt.Errorf("tariff calculator: %w", err)
	}
	if tariff == nil {
		return nil, ErrNoActiveTariff
	}

	fee, err := tc.computeFee(tariff, orderTotal)
	if err != nil {
		return nil, err
	}

	return &ResolvedTariff{
		TariffID:   tariff.ID,
		TariffType: tariff.Type,
		Fee:        fee,
	}, nil
}

// computeFee applies the tariff's pricing model to return the delivery fee.
func (tc *TariffCalculator) computeFee(tariff *DeliveryTariff, orderTotal float64) (float64, error) {
	switch tariff.Type {
	case TariffTypeFixed:
		if tariff.FixedFee == nil {
			return 0, fmt.Errorf("tariff %s is type fixed but has no fixed_fee", tariff.ID)
		}
		return *tariff.FixedFee, nil

	case TariffTypeTiered:
		for _, r := range tariff.Ranges {
			inRange := orderTotal >= r.MinAmount
			if inRange && (r.MaxAmount == nil || orderTotal < *r.MaxAmount) {
				return r.Fee, nil
			}
		}
		return 0, fmt.Errorf(
			"order total %.2f does not fall within any range of tariff %s",
			orderTotal, tariff.ID,
		)

	default:
		return 0, fmt.Errorf("unknown tariff type: %s", tariff.Type)
	}
}
