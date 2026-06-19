package compensation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Service encapsulates all compensation business logic.
type Service struct {
	repo     *Repository
	resolver *RateResolver
	tariff   *TariffCalculator
	snapshot *SnapshotBuilder
	logger   *activity.Logger
	db       *gorm.DB
}

// NewService wires up the compensation service and its sub-components.
func NewService(repo *Repository, logger *activity.Logger, db *gorm.DB) *Service {
	resolver := NewRateResolver(repo)
	tariffCalc := NewTariffCalculator(repo)
	snapshotBuilder := NewSnapshotBuilder(resolver, tariffCalc, repo)

	return &Service{
		repo:     repo,
		resolver: resolver,
		tariff:   tariffCalc,
		snapshot: snapshotBuilder,
		logger:   logger,
		db:       db,
	}
}

// ─── Commission config operations ─────────────────────────────────────────────

// CreateConfig creates a new commission config with full history management.
//
// Business rules enforced inside a single transaction:
//  1. Validate scope/type/rate/notes
//  2. Find the currently active (effective_to IS NULL) config for the same scope/type
//  3. Close it: set effective_to = new_effective_from − 1ms
//  4. Insert the new config row
//  5. Write a synchronous activity log entry (same tx)
func (s *Service) CreateConfig(
	ctx context.Context,
	actor ActorInfo,
	req CreateConfigRequest,
) (*CommissionConfig, error) {
	// ── Validate ──────────────────────────────────────────────────────────────
	if !req.CommissionType.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid commission_type: %s", req.CommissionType))
	}
	if req.Rate <= 0 || req.Rate > 1 {
		return nil, apperrors.BadRequest("rate must be greater than 0 and at most 1")
	}
	if req.EffectiveFrom.IsZero() {
		return nil, apperrors.BadRequest("effective_from is required")
	}
	if req.Notes == "" {
		return nil, apperrors.BadRequest("notes (reason) is required")
	}

	// Resolve scope to userID / teamID pointers.
	userID, teamID, err := s.parseScopeIDs(req.Scope, req.UserID, req.TeamID)
	if err != nil {
		return nil, err
	}

	var result *CommissionConfig

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Find existing active config for this scope/type (to close it).
		current, err := s.repo.GetActiveConfig(ctx, req.CommissionType, userID, teamID)
		if err != nil {
			return fmt.Errorf("find current active config: %w", err)
		}

		// Build before-state for audit log.
		var beforeState interface{}
		if current != nil {
			beforeState = map[string]interface{}{
				"config_id":      current.ID,
				"rate":           current.Rate,
				"effective_from": current.EffectiveFrom.Format(time.RFC3339),
			}
			// Close the current config at new_effective_from − 1 millisecond.
			closeAt := req.EffectiveFrom.Add(-time.Millisecond)
			if err := s.repo.CloseConfig(ctx, tx, current.ID, closeAt); err != nil {
				return fmt.Errorf("close previous config: %w", err)
			}
		}

		// Insert new config.
		newCfg := &CommissionConfig{
			ID:             uuid.New(),
			TeamID:         teamID,
			UserID:         userID,
			CommissionType: req.CommissionType,
			Rate:           req.Rate,
			EffectiveFrom:  req.EffectiveFrom.UTC(),
			Notes:          req.Notes,
			CreatedBy:      &actor.ID,
		}
		if err := s.repo.CreateConfig(ctx, tx, newCfg); err != nil {
			return fmt.Errorf("insert new config: %w", err)
		}

		// Determine activity log action string.
		action := "commission.global_rate_updated"
		if userID != nil {
			action = "commission.employee_rate_updated"
		} else if teamID != nil {
			action = "commission.team_rate_updated"
		}

		afterState := map[string]interface{}{
			"config_id":       newCfg.ID,
			"rate":            req.Rate,
			"effective_from":  req.EffectiveFrom.Format(time.RFC3339),
			"commission_type": req.CommissionType,
			"scope":           req.Scope,
		}

		// Write audit log synchronously inside the same transaction.
		entityID := newCfg.ID
		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:     &actor.ID,
			Action:      action,
			EntityType:  "commission_config",
			EntityID:    &entityID,
			BeforeState: beforeState,
			AfterState:  afterState,
			IPAddress:   actor.IPAddress,
			UserAgent:   actor.UserAgent,
			Reason:      &req.Notes,
		}); err != nil {
			return fmt.Errorf("write activity log: %w", err)
		}

		result = newCfg
		return nil
	})

	if txErr != nil {
		return nil, apperrors.Internal(txErr)
	}
	return result, nil
}

// DisableConfig manually closes an active config with a mandatory reason.
//
// Business rules:
//  1. Config must exist
//  2. Config must currently be active (effective_to IS NULL)
//  3. Set effective_to, write audit log — all in one transaction
func (s *Service) DisableConfig(
	ctx context.Context,
	actor ActorInfo,
	configID uuid.UUID,
	req DisableConfigRequest,
) error {
	if req.EffectiveTo.IsZero() {
		return apperrors.BadRequest("effective_to is required")
	}
	if req.Notes == "" {
		return apperrors.BadRequest("notes (reason) is required")
	}

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cfg, err := s.repo.GetConfigByID(ctx, configID)
		if err != nil {
			return err
		}
		if cfg == nil {
			return apperrors.NotFound("commission config")
		}
		if cfg.EffectiveTo != nil {
			return apperrors.Conflict("commission config is already closed")
		}

		beforeState := map[string]interface{}{
			"config_id":      cfg.ID,
			"rate":           cfg.Rate,
			"effective_from": cfg.EffectiveFrom.Format(time.RFC3339),
			"effective_to":   nil,
		}

		if err := s.repo.CloseConfig(ctx, tx, configID, req.EffectiveTo.UTC()); err != nil {
			return err
		}

		afterState := map[string]interface{}{
			"config_id":    configID,
			"effective_to": req.EffectiveTo.Format(time.RFC3339),
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:     &actor.ID,
			Action:      "commission.rate_disabled",
			EntityType:  "commission_config",
			EntityID:    &configID,
			BeforeState: beforeState,
			AfterState:  afterState,
			IPAddress:   actor.IPAddress,
			UserAgent:   actor.UserAgent,
			Reason:      &req.Notes,
		}); err != nil {
			return fmt.Errorf("write activity log: %w", err)
		}

		return nil
	})

	if txErr != nil {
		if appErr, ok := apperrors.AsAppError(txErr); ok {
			return appErr
		}
		return apperrors.Internal(txErr)
	}
	return nil
}

// GetConfigByID loads a single config. Returns NOT_FOUND if missing.
func (s *Service) GetConfigByID(ctx context.Context, id uuid.UUID) (*CommissionConfig, error) {
	cfg, err := s.repo.GetConfigByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if cfg == nil {
		return nil, apperrors.NotFound("commission config")
	}
	return cfg, nil
}

// ListConfigs returns a paginated, filtered list of commission configs.
func (s *Service) ListConfigs(
	ctx context.Context,
	filter ConfigFilter,
	p pagination.Params,
) ([]CommissionConfig, int, error) {
	list, total, err := s.repo.ListConfigs(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// GetGlobalRates returns the currently active global default for all 5 commission types.
// Returns NOT_FOUND if any type is missing (owner must seed before orders can be created).
func (s *Service) GetGlobalRates(ctx context.Context) (*GlobalRatesResponse, error) {
	resp := &GlobalRatesResponse{}

	for _, ct := range AllCommissionTypes {
		cfg, err := s.repo.GetActiveConfig(ctx, ct, nil, nil)
		if err != nil {
			return nil, apperrors.Internal(err)
		}
		if cfg == nil {
			return nil, apperrors.NotFound(fmt.Sprintf("global commission config for %s", ct))
		}

		entry := GlobalRateEntry{
			ConfigID:      cfg.ID,
			CommissionType: cfg.CommissionType,
			Rate:          cfg.Rate,
			EffectiveFrom: cfg.EffectiveFrom,
			Notes:         cfg.Notes,
		}

		switch ct {
		case CommissionTypeSellerRate:
			resp.SellerRate = entry
		case CommissionTypeManagerTeamRate:
			resp.ManagerTeamRate = entry
		case CommissionTypeManagerPersonalRate:
			resp.ManagerPersonalRate = entry
		case CommissionTypeTeamLeadPoolRate:
			resp.TeamLeadPoolRate = entry
		case CommissionTypeCompanyRate:
			resp.CompanyRate = entry
		}
	}

	return resp, nil
}

// GetConfigsForEmployee returns all commission configs (active + historical)
// for a specific employee, paginated and ordered by created_at DESC.
func (s *Service) GetConfigsForEmployee(
	ctx context.Context,
	userID uuid.UUID,
	p pagination.Params,
) ([]CommissionConfig, int, error) {
	filter := ConfigFilter{
		UserID: &userID,
		Scope:  "employee",
	}
	list, total, err := s.repo.ListConfigs(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// GetConfigsForTeam returns all commission configs (active + historical)
// for a specific team, paginated.
func (s *Service) GetConfigsForTeam(
	ctx context.Context,
	teamID uuid.UUID,
	p pagination.Params,
) ([]CommissionConfig, int, error) {
	filter := ConfigFilter{
		TeamID: &teamID,
		Scope:  "team",
	}
	list, total, err := s.repo.ListConfigs(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// GetHistory returns a paginated, filtered commission config history.
// Supports filtering by user_id, team_id, commission_type, and date range.
func (s *Service) GetHistory(
	ctx context.Context,
	filter ConfigFilter,
	p pagination.Params,
) ([]CommissionConfig, int, error) {
	list, total, err := s.repo.ListConfigs(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// Preview simulates the commission breakdown for a hypothetical order
// using current active rates for the given user/team/order parameters.
//
// CORRECTED COMMISSION RULES (applied here):
//   seller_order:
//     seller_commission          = net_revenue × seller_rate
//     manager_team_commission    = net_revenue × manager_team_rate
//     manager_personal_commission = 0
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
//
//   manager_personal_order:
//     seller_commission          = 0
//     manager_team_commission    = 0     ← manager cannot double-pay himself
//     manager_personal_commission = net_revenue × manager_personal_rate
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
//
//   team_lead_personal_order:
//     seller_commission          = 0
//     manager_team_commission    = net_revenue × manager_team_rate
//     manager_personal_commission = 0
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
func (s *Service) Preview(ctx context.Context, req PreviewRequest) (*PreviewResponse, error) {
	if !req.OrderType.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid order_type: %s", req.OrderType))
	}
	if req.OrderTotal <= 0 {
		return nil, apperrors.BadRequest("order_total must be greater than 0")
	}

	now := time.Now().UTC()

	// Build snapshot input for preview (no OrderID, no persistence).
	input := SnapshotInput{
		SellerID:     req.UserID,
		SellerTeamID: req.TeamID,
		ManagerID:    req.UserID,
		ManagerTeamID: req.TeamID,
		TeamLeadID:   req.UserID,
		TeamLeadTeamID: req.TeamID,
		OrderTotal:   req.OrderTotal,
		ResolvedAt:   now,
	}

	snap, err := s.snapshot.Build(ctx, input)
	if err != nil {
		if errors.Is(err, ErrNoRateConfigured) {
			return nil, apperrors.Unprocessable(err.Error())
		}
		if errors.Is(err, ErrNoActiveTariff) {
			return nil, apperrors.Unprocessable("no active delivery tariff configured")
		}
		return nil, apperrors.Internal(err)
	}

	deliveryFee := snap.TariffFee
	netRevenue := req.OrderTotal - deliveryFee

	// Apply order-type commission rules (residual pool, with validation).
	breakdown, err := ApplyCommissionRules(req.OrderType, netRevenue, snap)
	if err != nil {
		return nil, apperrors.Unprocessable(err.Error())
	}
	breakdown.CourierFee = deliveryFee

	// Build rate info for response.
	rates := ResolvedRatesInfo{
		SellerRate: RateInfo{
			Rate:          snap.SellerRate,
			Source:        snap.SellerRateSource,
			ConfigID:      ptrToUUID(snap.SellerConfigID),
			EffectiveFrom: now,
		},
		ManagerTeamRate: RateInfo{
			Rate:          snap.ManagerTeamRate,
			Source:        snap.ManagerTeamRateSource,
			ConfigID:      ptrToUUID(snap.ManagerTeamConfigID),
			EffectiveFrom: now,
		},
		ManagerPersonalRate: RateInfo{
			Rate:          snap.ManagerPersonalRate,
			Source:        snap.ManagerPersonalRateSource,
			ConfigID:      ptrToUUID(snap.ManagerPersonalConfigID),
			EffectiveFrom: now,
		},
		TeamLeadPoolRate: RateInfo{
			Rate:          snap.TeamLeadPoolRate,
			Source:        snap.TeamLeadPoolRateSource,
			ConfigID:      ptrToUUID(snap.TeamLeadPoolConfigID),
			EffectiveFrom: now,
		},
		CompanyRate: RateInfo{
			Rate:          snap.CompanyRate,
			Source:        snap.CompanyRateSource,
			ConfigID:      ptrToUUID(snap.CompanyConfigID),
			EffectiveFrom: now,
		},
	}

	if snap.TariffID != nil {
		rates.DeliveryTariff = TariffInfo{
			TariffID:   *snap.TariffID,
			TariffType: snap.TariffType,
			Fee:        snap.TariffFee,
		}
	}

	return &PreviewResponse{
		OrderType:   req.OrderType,
		OrderTotal:  req.OrderTotal,
		DeliveryFee: deliveryFee,
		NetRevenue:  netRevenue,
		Rates:       rates,
		Breakdown:   breakdown,
	}, nil
}

// PreviewRequest holds the parameters for the Preview call.
// (Kept here in service.go to avoid a separate file; used only by Preview.)
type PreviewRequest struct {
	UserID     *uuid.UUID
	TeamID     *uuid.UUID
	OrderTotal float64
	OrderType  OrderType
}

// ApplyCommissionRules computes the commission breakdown for one order.
//
// Business rules (revised):
//   - company_revenue is always a fixed percentage of net_revenue.
//   - seller_commission and manager commissions are fixed percentages.
//   - team_lead_pool is RESIDUAL: net_revenue minus all other commissions.
//     This guarantees company + seller + manager + pool == net_revenue exactly.
//
// Rate-sum validation (fail-fast):
//
//	seller_order:              company_rate + seller_rate + manager_team_rate  <= 1.0
//	manager_personal_order:   company_rate + manager_personal_rate            <= 1.0
//	team_lead_personal_order: company_rate + manager_team_rate                <= 1.0
//
// team_lead_pool_rate is kept in the snapshot for backward-compat/display but
// is NOT used in the calculation — pool is derived residually.
func ApplyCommissionRules(
	orderType OrderType,
	netRevenue float64,
	snap *OrderFinancialSnapshot,
) (CommissionBreakdown, error) {
	var b CommissionBreakdown

	switch orderType {
	case OrderTypeSellerOrder:
		total := snap.CompanyRate + snap.SellerRate + snap.ManagerTeamRate
		if total > 1.0 {
			return b, fmt.Errorf(
				"rate configuration error for seller_order: "+
					"company_rate(%.5f) + seller_rate(%.5f) + manager_team_rate(%.5f) = %.5f exceeds 1.0 — "+
					"adjust rates so they sum to at most 1.0",
				snap.CompanyRate, snap.SellerRate, snap.ManagerTeamRate, total,
			)
		}
		b.CompanyRevenue         = round2(netRevenue * snap.CompanyRate)
		b.SellerCommission       = round2(netRevenue * snap.SellerRate)
		b.ManagerTeamCommission  = round2(netRevenue * snap.ManagerTeamRate)
		b.ManagerPersonalCommission = 0
		// Residual: pool absorbs whatever is left after fixed commissions.
		b.TeamLeadPool = round2(netRevenue - b.CompanyRevenue - b.SellerCommission - b.ManagerTeamCommission)

	case OrderTypeManagerPersonalOrder:
		total := snap.CompanyRate + snap.ManagerPersonalRate
		if total > 1.0 {
			return b, fmt.Errorf(
				"rate configuration error for manager_personal_order: "+
					"company_rate(%.5f) + manager_personal_rate(%.5f) = %.5f exceeds 1.0",
				snap.CompanyRate, snap.ManagerPersonalRate, total,
			)
		}
		b.SellerCommission          = 0
		b.ManagerTeamCommission     = 0
		b.CompanyRevenue            = round2(netRevenue * snap.CompanyRate)
		b.ManagerPersonalCommission = round2(netRevenue * snap.ManagerPersonalRate)
		// Residual pool.
		b.TeamLeadPool = round2(netRevenue - b.CompanyRevenue - b.ManagerPersonalCommission)

	case OrderTypeTeamLeadPersonalOrder:
		total := snap.CompanyRate + snap.ManagerTeamRate
		if total > 1.0 {
			return b, fmt.Errorf(
				"rate configuration error for team_lead_personal_order: "+
					"company_rate(%.5f) + manager_team_rate(%.5f) = %.5f exceeds 1.0",
				snap.CompanyRate, snap.ManagerTeamRate, total,
			)
		}
		b.SellerCommission          = 0
		b.CompanyRevenue            = round2(netRevenue * snap.CompanyRate)
		b.ManagerTeamCommission     = round2(netRevenue * snap.ManagerTeamRate)
		b.ManagerPersonalCommission = 0
		// Residual pool.
		b.TeamLeadPool = round2(netRevenue - b.CompanyRevenue - b.ManagerTeamCommission)

	default:
		return b, fmt.Errorf("ApplyCommissionRules: unknown order_type %q", orderType)
	}

	return b, nil
}

// round2 rounds to 2 decimal places (standard for monetary amounts).
func round2(v float64) float64 {
	// Use integer arithmetic to avoid floating-point drift.
	return float64(int64(v*100+0.5)) / 100
}

// ─── Delivery tariff operations ───────────────────────────────────────────────

// CreateTariff creates a new delivery tariff.
//
// Business rules:
//  1. Validate type / fee / ranges
//  2. Deactivate the current active tariff (set effective_to = new_effective_from − 1ms)
//  3. Insert new tariff + ranges
//  4. Write synchronous audit log
func (s *Service) CreateTariff(
	ctx context.Context,
	actor ActorInfo,
	req CreateTariffRequest,
) (*DeliveryTariff, error) {
	// ── Validate ──────────────────────────────────────────────────────────────
	if err := validateTariffRequest(req); err != nil {
		return nil, err
	}

	var result *DeliveryTariff

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Deactivate the currently active tariff (if any).
		current, err := s.repo.GetActiveTariff(ctx)
		if err != nil {
			return fmt.Errorf("find active tariff: %w", err)
		}

		var beforeState interface{}
		if current != nil {
			beforeState = map[string]interface{}{
				"tariff_id":      current.ID,
				"name":           current.Name,
				"type":           current.Type,
				"effective_from": current.EffectiveFrom.Format(time.RFC3339),
			}
			closeAt := req.EffectiveFrom.Add(-time.Millisecond)
			if err := s.repo.CloseTariff(ctx, tx, current.ID, closeAt); err != nil {
				return fmt.Errorf("close current tariff: %w", err)
			}
		}

		// Build new tariff.
		newTariff := &DeliveryTariff{
			ID:            uuid.New(),
			Name:          req.Name,
			Type:          req.Type,
			FixedFee:      req.FixedFee,
			IsActive:      true,
			EffectiveFrom: req.EffectiveFrom.UTC(),
			Notes:         req.Notes,
			CreatedBy:     &actor.ID,
		}
		if err := s.repo.CreateTariff(ctx, tx, newTariff); err != nil {
			return err
		}

		// Build and insert ranges for tiered tariff.
		if req.Type == TariffTypeTiered {
			ranges := make([]DeliveryTariffRange, len(req.Ranges))
			for i, ri := range req.Ranges {
				ranges[i] = DeliveryTariffRange{
					ID:        uuid.New(),
					TariffID:  newTariff.ID,
					MinAmount: ri.MinAmount,
					MaxAmount: ri.MaxAmount,
					Fee:       ri.Fee,
					SortOrder: i,
				}
			}
			if err := s.repo.CreateTariffRanges(ctx, tx, ranges); err != nil {
				return err
			}
			newTariff.Ranges = ranges
		}

		// Audit log.
		afterState := map[string]interface{}{
			"tariff_id":      newTariff.ID,
			"name":           req.Name,
			"type":           req.Type,
			"effective_from": req.EffectiveFrom.Format(time.RFC3339),
		}
		tariffID := newTariff.ID
		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:     &actor.ID,
			Action:      "tariff.created",
			EntityType:  "delivery_tariff",
			EntityID:    &tariffID,
			BeforeState: beforeState,
			AfterState:  afterState,
			IPAddress:   actor.IPAddress,
			UserAgent:   actor.UserAgent,
			Reason:      &req.Notes,
		}); err != nil {
			return fmt.Errorf("write activity log: %w", err)
		}

		result = newTariff
		return nil
	})

	if txErr != nil {
		return nil, apperrors.Internal(txErr)
	}
	return result, nil
}

// DeactivateTariff closes an active tariff manually with a mandatory reason.
func (s *Service) DeactivateTariff(
	ctx context.Context,
	actor ActorInfo,
	tariffID uuid.UUID,
	req DeactivateTariffRequest,
) error {
	if req.EffectiveTo.IsZero() {
		return apperrors.BadRequest("effective_to is required")
	}
	if req.Notes == "" {
		return apperrors.BadRequest("notes (reason) is required")
	}

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		t, err := s.repo.GetTariffByID(ctx, tariffID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperrors.NotFound("delivery tariff")
		}
		if t.EffectiveTo != nil || !t.IsActive {
			return apperrors.Conflict("delivery tariff is already deactivated")
		}

		beforeState := map[string]interface{}{
			"tariff_id":    tariffID,
			"name":         t.Name,
			"effective_to": nil,
		}

		if err := s.repo.CloseTariff(ctx, tx, tariffID, req.EffectiveTo.UTC()); err != nil {
			return err
		}

		afterState := map[string]interface{}{
			"tariff_id":    tariffID,
			"effective_to": req.EffectiveTo.Format(time.RFC3339),
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:     &actor.ID,
			Action:      "tariff.deactivated",
			EntityType:  "delivery_tariff",
			EntityID:    &tariffID,
			BeforeState: beforeState,
			AfterState:  afterState,
			IPAddress:   actor.IPAddress,
			UserAgent:   actor.UserAgent,
			Reason:      &req.Notes,
		}); err != nil {
			return fmt.Errorf("write activity log: %w", err)
		}

		return nil
	})

	if txErr != nil {
		if appErr, ok := apperrors.AsAppError(txErr); ok {
			return appErr
		}
		return apperrors.Internal(txErr)
	}
	return nil
}

// GetActiveTariff returns the currently active tariff with ranges.
func (s *Service) GetActiveTariff(ctx context.Context) (*DeliveryTariff, error) {
	t, err := s.repo.GetActiveTariff(ctx)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if t == nil {
		return nil, apperrors.NotFound("active delivery tariff")
	}
	return t, nil
}

// GetTariffByID loads a tariff with its ranges.
func (s *Service) GetTariffByID(ctx context.Context, id uuid.UUID) (*DeliveryTariff, error) {
	t, err := s.repo.GetTariffByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if t == nil {
		return nil, apperrors.NotFound("delivery tariff")
	}
	return t, nil
}

// ListTariffs returns a paginated list of all tariffs (active and historical).
func (s *Service) ListTariffs(ctx context.Context, p pagination.Params) ([]DeliveryTariff, int, error) {
	list, total, err := s.repo.ListTariffs(ctx, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// ─── Snapshot API (called by Phase 4 Orders module) ───────────────────────────

// BuildSnapshot resolves all rates and persists a snapshot inside the caller's transaction.
// Phase 4 (orders module) calls this inside the order creation transaction.
func (s *Service) BuildSnapshot(
	ctx context.Context,
	tx *gorm.DB,
	input SnapshotInput,
) (*OrderFinancialSnapshot, error) {
	snap, err := s.snapshot.BuildAndSave(ctx, tx, input)
	if err != nil {
		if errors.Is(err, ErrNoRateConfigured) {
			return nil, apperrors.Unprocessable(err.Error())
		}
		if errors.Is(err, ErrNoActiveTariff) {
			return nil, apperrors.Unprocessable("no active delivery tariff configured")
		}
		return nil, apperrors.Internal(err)
	}
	return snap, nil
}

// ─── Financial event API (called by Phase 4 Financial Engine) ─────────────────

// ListFinancialEventsByOrderID returns all ledger events for an order.
// Added Phase 6 — used by the reporting endpoint and E2E validation.
func (s *Service) ListFinancialEventsByOrderID(ctx context.Context, orderID uuid.UUID) ([]FinancialEvent, error) {
	events, err := s.repo.ListFinancialEventsByOrderID(ctx, orderID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return events, nil
}

// RecordFinancialEvent persists an immutable financial ledger entry inside a transaction.
// Phase 4 Financial Engine calls this when processing order status transitions.
func (s *Service) RecordFinancialEvent(
	ctx context.Context,
	tx *gorm.DB,
	event *FinancialEvent,
) error {
	if err := s.repo.CreateFinancialEvent(ctx, tx, event); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

// GetSnapshotByOrderID loads the financial snapshot for an order.
// Called by Phase 4 Financial Engine inside the delivery status-change transaction.
func (s *Service) GetSnapshotByOrderID(ctx context.Context, orderID uuid.UUID) (*OrderFinancialSnapshot, error) {
	snap, err := s.repo.GetSnapshotByOrderID(ctx, orderID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return snap, nil
}

// ─── Employee compensation (fixed salary) ─────────────────────────────────────

// GetEmployeeCompensation returns the active salary/compensation config for a user.
func (s *Service) GetEmployeeCompensation(ctx context.Context, userID uuid.UUID) (*EmployeeCompensation, error) {
	ec, err := s.repo.GetActiveEmployeeCompensation(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return ec, nil
}

// ListEmployeeCompensations returns full compensation history for a user.
func (s *Service) ListEmployeeCompensations(ctx context.Context, userID uuid.UUID) ([]EmployeeCompensation, error) {
	rows, err := s.repo.ListEmployeeCompensations(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return rows, nil
}

// SetEmployeeCompensation creates a new compensation record (closing any previous one).
func (s *Service) SetEmployeeCompensation(
	ctx context.Context,
	actor ActorInfo,
	userID uuid.UUID,
	req SetCompensationRequest,
) (*EmployeeCompensation, error) {
	if !req.CompensationType.isValid() {
		return nil, apperrors.BadRequest("invalid compensation_type")
	}
	if req.EffectiveFrom.IsZero() {
		return nil, apperrors.BadRequest("effective_from is required")
	}
	// Validate that the right amounts are provided for the type.
	switch req.CompensationType {
	case CompensationKindPercent:
		if req.CommissionRate == nil {
			return nil, apperrors.BadRequest("commission_rate is required for percent type")
		}
	case CompensationKindFixed:
		if req.FixedSalary == nil {
			return nil, apperrors.BadRequest("fixed_salary is required for fixed type")
		}
	case CompensationKindMixed:
		if req.CommissionRate == nil || req.FixedSalary == nil {
			return nil, apperrors.BadRequest("commission_rate and fixed_salary are required for mixed type")
		}
	}

	currency := req.Currency
	if currency == "" {
		currency = "TJS"
	}

	ec := &EmployeeCompensation{
		UserID:           userID,
		CompensationType: req.CompensationType,
		CommissionRate:   req.CommissionRate,
		FixedSalary:      req.FixedSalary,
		Currency:         currency,
		EffectiveFrom:    req.EffectiveFrom,
		Notes:            req.Notes,
		CreatedBy:        &actor.ID,
		IsActive:         true,
	}
	if err := s.repo.CreateEmployeeCompensation(ctx, ec); err != nil {
		return nil, apperrors.Internal(err)
	}
	return ec, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// parseScopeIDs validates scope + ID combination and returns (userID, teamID).
func (s *Service) parseScopeIDs(
	scope string,
	userID, teamID *uuid.UUID,
) (*uuid.UUID, *uuid.UUID, error) {
	switch scope {
	case "global":
		if userID != nil || teamID != nil {
			return nil, nil, apperrors.BadRequest("global scope must not have user_id or team_id")
		}
		return nil, nil, nil

	case "team":
		if teamID == nil {
			return nil, nil, apperrors.BadRequest("team_id is required for team scope")
		}
		if userID != nil {
			return nil, nil, apperrors.BadRequest("user_id must be omitted for team scope")
		}
		return nil, teamID, nil

	case "employee":
		if userID == nil {
			return nil, nil, apperrors.BadRequest("user_id is required for employee scope")
		}
		return userID, nil, nil

	default:
		return nil, nil, apperrors.BadRequest(
			fmt.Sprintf("invalid scope %q: must be global, team, or employee", scope),
		)
	}
}

// validateTariffRequest validates a CreateTariffRequest.
func validateTariffRequest(req CreateTariffRequest) *apperrors.AppError {
	if req.Name == "" {
		return apperrors.BadRequest("name is required")
	}
	if req.EffectiveFrom.IsZero() {
		return apperrors.BadRequest("effective_from is required")
	}
	if req.Notes == "" {
		return apperrors.BadRequest("notes (reason) is required")
	}

	switch req.Type {
	case TariffTypeFixed:
		if req.FixedFee == nil || *req.FixedFee <= 0 {
			return apperrors.BadRequest("fixed_fee must be greater than 0 for type=fixed")
		}
		if len(req.Ranges) > 0 {
			return apperrors.BadRequest("ranges must be empty for type=fixed")
		}

	case TariffTypeTiered:
		if len(req.Ranges) == 0 {
			return apperrors.BadRequest("at least one range is required for type=tiered")
		}
		if req.FixedFee != nil {
			return apperrors.BadRequest("fixed_fee must be omitted for type=tiered")
		}
		if err := validateTariffRanges(req.Ranges); err != nil {
			return err
		}

	default:
		return apperrors.BadRequest(fmt.Sprintf("invalid type: %s (must be fixed or tiered)", req.Type))
	}

	return nil
}

// validateTariffRanges checks for overlapping or invalid tier ranges.
func validateTariffRanges(ranges []TariffRangeInput) *apperrors.AppError {
	for i, r := range ranges {
		if r.Fee <= 0 {
			return apperrors.BadRequest(fmt.Sprintf("range[%d]: fee must be greater than 0", i))
		}
		if r.MinAmount < 0 {
			return apperrors.BadRequest(fmt.Sprintf("range[%d]: min_amount must be >= 0", i))
		}
		if r.MaxAmount != nil && *r.MaxAmount <= r.MinAmount {
			return apperrors.BadRequest(fmt.Sprintf(
				"range[%d]: max_amount (%.2f) must be greater than min_amount (%.2f)",
				i, *r.MaxAmount, r.MinAmount,
			))
		}
	}

	// Check for overlapping ranges (O(n²) — fine for small range counts).
	// Two ranges overlap unless one ends at or before the other starts.
	for i := 0; i < len(ranges); i++ {
		for j := i + 1; j < len(ranges); j++ {
			a, b := ranges[i], ranges[j]
			// a ends before b starts (no overlap)
			aEndsBeforeB := a.MaxAmount != nil && *a.MaxAmount <= b.MinAmount
			// b ends before a starts (no overlap)
			bEndsBeforeA := b.MaxAmount != nil && *b.MaxAmount <= a.MinAmount
			if !aEndsBeforeB && !bEndsBeforeA {
				return apperrors.BadRequest(fmt.Sprintf(
					"ranges[%d] and ranges[%d] overlap", i, j,
				))
			}
		}
	}

	return nil
}

// ptrToUUID safely dereferences a *uuid.UUID, returning uuid.Nil if nil.
func ptrToUUID(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}
