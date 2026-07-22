package compensation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	delivery_settings "github.com/megamall/crm/internal/delivery_settings"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Service encapsulates all compensation business logic.
type Service struct {
	repo     *Repository
	resolver *RateResolver
	snapshot *SnapshotBuilder
	logger   *activity.Logger
	db       *gorm.DB
	loc      *time.Location // for interpreting bare YYYY-MM-DD period params as local midnight
}

// NewService wires up the compensation service and its sub-components.
func NewService(repo *Repository, logger *activity.Logger, db *gorm.DB, loc *time.Location) *Service {
	resolver := NewRateResolver(repo)
	snapshotBuilder := NewSnapshotBuilder(resolver, repo)

	if loc == nil {
		loc = time.UTC
	}

	return &Service{
		repo:     repo,
		resolver: resolver,
		snapshot: snapshotBuilder,
		logger:   logger,
		db:       db,
		loc:      loc,
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
			ConfigID:       cfg.ID,
			CommissionType: cfg.CommissionType,
			Rate:           cfg.Rate,
			EffectiveFrom:  cfg.EffectiveFrom,
			Notes:          cfg.Notes,
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
//
// All commission lines below use commission_base = order_total - courier_payout.
// team_lead_pool_rate creates the gross team pool; TeamLeadPool returned by the
// API is the team lead's net residual after seller/manager payouts. company_rate
// is resolved and returned for audit/config visibility, while CompanyRevenue is
// the remainder outside the gross team pool.
//
//	seller_order:
//	  seller_commission          = commission_base × seller_rate
//	  manager_team_commission    = commission_base × manager_team_rate
//	  manager_personal_commission = 0
//	  team_lead_pool             = commission_base × team_lead_pool_rate − seller − manager
//	  company_revenue            = commission_base − commission_base × team_lead_pool_rate
//
//	manager_personal_order:
//	  seller_commission          = 0
//	  manager_team_commission    = 0     ← manager cannot double-pay himself
//	  manager_personal_commission = commission_base × manager_personal_rate
//	  team_lead_pool             = commission_base × team_lead_pool_rate − manager_personal
//	  company_revenue            = commission_base − commission_base × team_lead_pool_rate
//
//	team_lead_personal_order:
//	  seller_commission          = 0
//	  manager_team_commission    = commission_base × manager_team_rate
//	  manager_personal_commission = 0
//	  team_lead_pool             = commission_base × team_lead_pool_rate − manager
//	  company_revenue            = commission_base − commission_base × team_lead_pool_rate
func (s *Service) Preview(ctx context.Context, req PreviewRequest) (*PreviewResponse, error) {
	if !req.OrderType.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid order_type: %s", req.OrderType))
	}
	if req.OrderTotal <= 0 {
		return nil, apperrors.BadRequest("order_total must be greater than 0")
	}

	now := time.Now().UTC()

	// Default the delivery fee to the current global "normal" rate
	// (delivery_settings — the same value shown in Логистика → Настройки
	// доставки) when the caller doesn't provide one explicitly.
	deliveryFee := 0.0
	if req.DeliveryFee != nil {
		deliveryFee = *req.DeliveryFee
	} else if fee, ferr := delivery_settings.GetFee(s.db, "normal"); ferr == nil {
		deliveryFee = fee
	}

	// Build snapshot input for preview (no OrderID, no persistence).
	input := SnapshotInput{
		SellerID:       req.UserID,
		SellerTeamID:   req.TeamID,
		ManagerID:      req.UserID,
		ManagerTeamID:  req.TeamID,
		TeamLeadID:     req.UserID,
		TeamLeadTeamID: req.TeamID,
		DeliveryFee:    deliveryFee,
		ResolvedAt:     now,
	}

	snap, err := s.snapshot.Build(ctx, input)
	if err != nil {
		if errors.Is(err, ErrNoRateConfigured) {
			return nil, apperrors.Unprocessable(err.Error())
		}
		return nil, apperrors.Internal(err)
	}

	netRevenue := req.OrderTotal - deliveryFee

	courierPayout := req.CourierPayout
	commissionBase := req.OrderTotal - courierPayout
	if commissionBase < 0 {
		return nil, apperrors.BadRequest("courier_payout exceeds order_total")
	}

	// Apply order-type commission rules to the amount left after courier payout.
	breakdown, err := ApplyCommissionRules(req.OrderType, commissionBase, snap)
	if err != nil {
		return nil, apperrors.Unprocessable(err.Error())
	}
	breakdown.CourierFee = courierPayout

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

	return &PreviewResponse{
		OrderType:      req.OrderType,
		OrderTotal:     req.OrderTotal,
		DeliveryFee:    deliveryFee,
		NetRevenue:     netRevenue,
		CourierPayout:  courierPayout,
		CommissionBase: commissionBase,
		Rates:          rates,
		Breakdown:      breakdown,
	}, nil
}

// PreviewRequest holds the parameters for the Preview call.
// (Kept here in service.go to avoid a separate file; used only by Preview.)
type PreviewRequest struct {
	UserID        *uuid.UUID
	TeamID        *uuid.UUID
	OrderTotal    float64
	OrderType     OrderType
	DeliveryFee   *float64
	CourierPayout float64
}

// ApplyCommissionRules computes the commission breakdown for one order.
//
// Business rules:
//   - team_lead_pool_gross is always a fixed percentage of net_revenue
//     (team_lead_pool_rate) — sellers and managers are paid OUT OF this pool.
//   - seller_commission and manager commissions are fixed percentages of
//     net_revenue, subtracted from the gross pool to leave the team lead's
//     net take: team_lead_pool = team_lead_pool_gross − seller − manager.
//   - company_revenue is RESIDUAL: net_revenue minus the gross pool.
//     This guarantees company + pool_gross == net_revenue exactly, and
//     therefore company + seller + manager + team_lead_pool == net_revenue.
//
// company_rate is kept in the snapshot for display/history but is NOT used in
// the calculation — company's share is whatever remains after the team pool.
//
// Rate-sum validation (fail-fast, prevents a negative team lead net):
//
//	seller_order:              seller_rate + manager_team_rate      <= team_lead_pool_rate
//	manager_personal_order:   manager_personal_rate                <= team_lead_pool_rate
//	team_lead_personal_order: manager_team_rate                    <= team_lead_pool_rate
func ApplyCommissionRules(
	orderType OrderType,
	netRevenue float64,
	snap *OrderFinancialSnapshot,
) (CommissionBreakdown, error) {
	var b CommissionBreakdown

	poolGross := round2(netRevenue * snap.TeamLeadPoolRate)

	switch orderType {
	case OrderTypeSellerOrder:
		total := snap.SellerRate + snap.ManagerTeamRate
		if total > snap.TeamLeadPoolRate {
			return b, fmt.Errorf(
				"rate configuration error for seller_order: "+
					"seller_rate(%.5f) + manager_team_rate(%.5f) = %.5f exceeds team_lead_pool_rate(%.5f) — "+
					"team lead pool cannot go negative",
				snap.SellerRate, snap.ManagerTeamRate, total, snap.TeamLeadPoolRate,
			)
		}
		b.SellerCommission = round2(netRevenue * snap.SellerRate)
		b.ManagerTeamCommission = round2(netRevenue * snap.ManagerTeamRate)
		b.ManagerPersonalCommission = 0
		b.TeamLeadPool = round2(poolGross - b.SellerCommission - b.ManagerTeamCommission)
		b.CompanyRevenue = round2(netRevenue - poolGross)

	case OrderTypeManagerPersonalOrder:
		if snap.ManagerPersonalRate > snap.TeamLeadPoolRate {
			return b, fmt.Errorf(
				"rate configuration error for manager_personal_order: "+
					"manager_personal_rate(%.5f) exceeds team_lead_pool_rate(%.5f) — "+
					"team lead pool cannot go negative",
				snap.ManagerPersonalRate, snap.TeamLeadPoolRate,
			)
		}
		b.SellerCommission = 0
		b.ManagerTeamCommission = 0
		b.ManagerPersonalCommission = round2(netRevenue * snap.ManagerPersonalRate)
		b.TeamLeadPool = round2(poolGross - b.ManagerPersonalCommission)
		b.CompanyRevenue = round2(netRevenue - poolGross)

	case OrderTypeTeamLeadPersonalOrder:
		if snap.ManagerTeamRate > snap.TeamLeadPoolRate {
			return b, fmt.Errorf(
				"rate configuration error for team_lead_personal_order: "+
					"manager_team_rate(%.5f) exceeds team_lead_pool_rate(%.5f) — "+
					"team lead pool cannot go negative",
				snap.ManagerTeamRate, snap.TeamLeadPoolRate,
			)
		}
		b.SellerCommission = 0
		b.ManagerTeamCommission = round2(netRevenue * snap.ManagerTeamRate)
		b.ManagerPersonalCommission = 0
		b.TeamLeadPool = round2(poolGross - b.ManagerTeamCommission)
		b.CompanyRevenue = round2(netRevenue - poolGross)

	case OrderTypeHouseOrder:
		// Owner-created order with no seller/team attribution — no one earns
		// a commission; the full commission base is company revenue.
		b.SellerCommission = 0
		b.ManagerTeamCommission = 0
		b.ManagerPersonalCommission = 0
		b.TeamLeadPool = 0
		b.CompanyRevenue = round2(netRevenue)

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
		return nil, apperrors.Internal(err)
	}
	return snap, nil
}

// ─── Financial event API (called by Phase 4 Financial Engine) ─────────────────

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

// roleCommissionType maps a caller's role to the CommissionConfig rate that
// represents their own earnings percentage, used as a fallback in
// GetMyResolvedRate when no fixed EmployeeCompensation record is set.
var roleCommissionType = map[string]CommissionType{
	"seller":          CommissionTypeSellerRate,
	"manager":         CommissionTypeManagerPersonalRate,
	"sales_team_lead": CommissionTypeTeamLeadPoolRate,
}

// GetMyResolvedRate resolves the caller's current commission rate straight from
// CommissionConfig (employee -> team -> global fallback), based on their role.
// Returns nil if the role has no applicable rate or none is configured.
func (s *Service) GetMyResolvedRate(ctx context.Context, userID uuid.UUID, teamID *uuid.UUID, role string) (*ResolvedRate, error) {
	ct, ok := roleCommissionType[role]
	if !ok {
		return nil, nil
	}
	rate, err := s.resolver.Resolve(ctx, &userID, teamID, ct, time.Now())
	if err != nil {
		if errors.Is(err, ErrNoRateConfigured) {
			return nil, nil
		}
		return nil, apperrors.Internal(err)
	}
	return rate, nil
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

// GetSellerTeamRank returns (rank, totalTeamMembers, error) for the requesting seller
// based on this month's seller_commission_earned financial events. No teammate amounts exposed.
func (s *Service) GetSellerTeamRank(ctx context.Context, sellerID uuid.UUID) (int, int, error) {
	type row struct {
		UserID uuid.UUID `gorm:"column:user_id"`
		Total  float64   `gorm:"column:total"`
	}
	var rows []row
	err := s.db.WithContext(ctx).Raw(`
		WITH team AS (
		    SELECT team_id
		    FROM user_hierarchy
		    WHERE user_id = ?
		    LIMIT 1
		),
		members AS (
		    SELECT uh.user_id
		    FROM user_hierarchy uh
		    JOIN team t ON t.team_id IS NOT NULL AND uh.team_id = t.team_id
		),
		earnings AS (
		    SELECT fe.user_id,
		           COALESCE(SUM(fe.amount), 0) AS total
		    FROM financial_events fe
		    JOIN members m ON m.user_id = fe.user_id
		    WHERE fe.event_type = 'seller_commission_earned'
		      AND fe.created_at >= date_trunc('month', now())
		    GROUP BY fe.user_id
		),
		all_members AS (
		    SELECT m.user_id, COALESCE(e.total, 0) AS total
		    FROM members m
		    LEFT JOIN earnings e ON e.user_id = m.user_id
		),
		ranked AS (
		    SELECT user_id, total,
		           RANK() OVER (ORDER BY total DESC) AS rank
		    FROM all_members
		)
		SELECT user_id, total FROM ranked ORDER BY rank
	`, sellerID).Scan(&rows).Error
	if err != nil {
		return 1, 1, apperrors.Internal(err)
	}
	if len(rows) == 0 {
		return 1, 1, nil
	}

	total := len(rows)
	rank := 1
	for i, r := range rows {
		if r.UserID == sellerID {
			rank = i + 1
			break
		}
	}
	return rank, total, nil
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

// ptrToUUID safely dereferences a *uuid.UUID, returning uuid.Nil if nil.
func ptrToUUID(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}
