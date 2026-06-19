package compensation

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ResolvedRate holds the result of a single commission rate resolution.
type ResolvedRate struct {
	Rate          float64
	Source        RateSource
	ConfigID      uuid.UUID
	EffectiveFrom time.Time
}

// RateResolver determines the correct commission rate for a given
// (user, team, commission_type, timestamp) using a strict priority order:
//
//  Priority 1 — Employee-level override  (highest)
//  Priority 2 — Team-level override
//  Priority 3 — Global default           (lowest)
//
// Resolution stops at the first level that returns a result.
// If no level is configured, Resolve returns ErrNoRateConfigured.
type RateResolver struct {
	repo *Repository
}

// NewRateResolver creates a RateResolver backed by repo.
func NewRateResolver(repo *Repository) *RateResolver {
	return &RateResolver{repo: repo}
}

// ErrNoRateConfigured is returned when no commission rate is configured for the
// given scope/type at the requested time. This blocks order creation.
var ErrNoRateConfigured = fmt.Errorf("no commission rate configured")

// Resolve returns the rate active at `at` for the given user/team/type.
//
//   - userID may be nil (skips employee-level lookup).
//   - teamID may be nil (skips team-level lookup).
//   - For company_rate, always pass userID=nil and teamID=nil (always global).
//
// Returns ErrNoRateConfigured (wrapped) if none of the three levels has a config.
func (r *RateResolver) Resolve(
	ctx context.Context,
	userID, teamID *uuid.UUID,
	commissionType CommissionType,
	at time.Time,
) (*ResolvedRate, error) {
	// ── Priority 1: employee-level ────────────────────────────────────────────
	if userID != nil {
		cfg, err := r.repo.ResolveRateAtTime(ctx, commissionType, userID, nil, at)
		if err != nil {
			return nil, fmt.Errorf("resolve %s employee rate: %w", commissionType, err)
		}
		if cfg != nil {
			return &ResolvedRate{
				Rate:          cfg.Rate,
				Source:        RateSourceEmployee,
				ConfigID:      cfg.ID,
				EffectiveFrom: cfg.EffectiveFrom,
			}, nil
		}
	}

	// ── Priority 2: team-level ────────────────────────────────────────────────
	if teamID != nil {
		cfg, err := r.repo.ResolveRateAtTime(ctx, commissionType, nil, teamID, at)
		if err != nil {
			return nil, fmt.Errorf("resolve %s team rate: %w", commissionType, err)
		}
		if cfg != nil {
			return &ResolvedRate{
				Rate:          cfg.Rate,
				Source:        RateSourceTeam,
				ConfigID:      cfg.ID,
				EffectiveFrom: cfg.EffectiveFrom,
			}, nil
		}
	}

	// ── Priority 3: global default ────────────────────────────────────────────
	cfg, err := r.repo.ResolveRateAtTime(ctx, commissionType, nil, nil, at)
	if err != nil {
		return nil, fmt.Errorf("resolve %s global rate: %w", commissionType, err)
	}
	if cfg != nil {
		return &ResolvedRate{
			Rate:          cfg.Rate,
			Source:        RateSourceGlobal,
			ConfigID:      cfg.ID,
			EffectiveFrom: cfg.EffectiveFrom,
		}, nil
	}

	// No rate configured at any level.
	return nil, fmt.Errorf("%w: type=%s user=%v team=%v at=%s",
		ErrNoRateConfigured, commissionType, userID, teamID, at.Format(time.RFC3339))
}
