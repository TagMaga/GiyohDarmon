package compensation

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SnapshotInput contains all participant IDs and order context needed to
// build an order_financial_snapshot.
//
// Called by Phase 4 (orders module) inside the order creation transaction.
// All uuid.UUID pointers may be nil when irrelevant (e.g. no manager on this order).
//
// COMMISSION RULES PER ORDER TYPE (applied by the Financial Engine, not here):
//
//   seller_order:
//     - seller_rate       → seller (SellerID / SellerTeamID)
//     - manager_team_rate → manager (ManagerID / ManagerTeamID)
//     - team_lead_pool_rate → team lead (TeamLeadID / TeamLeadTeamID)
//     - company_rate      → global always
//
//   manager_personal_order:
//     - manager_personal_rate → manager
//     - team_lead_pool_rate   → team lead
//     - company_rate          → global
//     - manager_team_rate     = 0  (manager cannot double-pay himself)
//     - seller_rate           = 0
//
//   team_lead_personal_order:
//     - manager_team_rate     → manager
//     - team_lead_pool_rate   → team lead
//     - company_rate          → global
//     - seller_rate           = 0
//     - manager_personal_rate = 0
//
// The snapshot stores ALL 5 resolved rates. The Financial Engine (Phase 4)
// applies order-type zeroing rules when creating financial_events.
type SnapshotInput struct {
	// OrderID is nil during preview; set to the order's ID by Phase 4.
	OrderID *uuid.UUID

	// Seller's participant info.
	SellerID     *uuid.UUID
	SellerTeamID *uuid.UUID // seller's team (for team-level rate lookup)

	// Manager's participant info (from user_hierarchy).
	ManagerID     *uuid.UUID
	ManagerTeamID *uuid.UUID // manager's team (for team-level rate lookup)

	// Team lead's participant info (from user_hierarchy).
	TeamLeadID     *uuid.UUID
	TeamLeadTeamID *uuid.UUID // team lead's team (for team-level rate lookup)

	// DeliveryFee is the authoritative client delivery fee resolved from
	// delivery_settings (or a per-product override) by the caller, frozen
	// into the snapshot as-is.
	DeliveryFee float64

	// ResolvedAt is the timestamp at which rates are frozen (= order.created_at).
	// Pass time.Now() when calling from Phase 4 order creation.
	ResolvedAt time.Time
}

// SnapshotBuilder resolves all 5 commission rates, then builds (and optionally
// persists) an OrderFinancialSnapshot.
type SnapshotBuilder struct {
	resolver *RateResolver
	repo     *Repository
}

// NewSnapshotBuilder creates a SnapshotBuilder wired to the given sub-components.
func NewSnapshotBuilder(resolver *RateResolver, repo *Repository) *SnapshotBuilder {
	return &SnapshotBuilder{
		resolver: resolver,
		repo:     repo,
	}
}

// BuildAndSave resolves all rates, builds the snapshot, and saves it to the DB
// inside the provided transaction tx.
//
// Designed to be called by Phase 4 (orders module) inside the order creation
// transaction. If any rate resolution fails, the error propagates and
// the outer transaction is rolled back — no order is created without a snapshot.
//
// Phase 4 usage pattern:
//
//	db.Transaction(func(tx *gorm.DB) error {
//	    // 1. Insert order row
//	    // 2. Call SnapshotBuilder.BuildAndSave(ctx, tx, input)
//	    // 3. Set order.SnapshotID = snapshot.ID, order.DeliveryFee = snapshot.DeliveryFee
//	    // 4. Update order row
//	    return nil
//	})
func (sb *SnapshotBuilder) BuildAndSave(
	ctx context.Context,
	tx *gorm.DB,
	input SnapshotInput,
) (*OrderFinancialSnapshot, error) {
	s, err := sb.resolve(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := sb.repo.CreateSnapshot(ctx, tx, s); err != nil {
		return nil, err
	}
	return s, nil
}

// Build resolves rates and builds the snapshot struct WITHOUT saving to the DB.
// Used by the Preview endpoint to simulate what the snapshot would look like.
func (sb *SnapshotBuilder) Build(ctx context.Context, input SnapshotInput) (*OrderFinancialSnapshot, error) {
	return sb.resolve(ctx, input)
}

// resolve is the shared implementation: resolves all 5 rates, builds and
// returns the snapshot struct (not yet persisted).
func (sb *SnapshotBuilder) resolve(ctx context.Context, input SnapshotInput) (*OrderFinancialSnapshot, error) {
	at := input.ResolvedAt
	if at.IsZero() {
		at = time.Now().UTC()
	}

	// ── Resolve all five commission rates ─────────────────────────────────────

	sellerR, err := sb.resolver.Resolve(ctx, input.SellerID, input.SellerTeamID,
		CommissionTypeSellerRate, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	mgrTeamR, err := sb.resolver.Resolve(ctx, input.ManagerID, input.ManagerTeamID,
		CommissionTypeManagerTeamRate, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	mgrPersonalR, err := sb.resolver.Resolve(ctx, input.ManagerID, input.ManagerTeamID,
		CommissionTypeManagerPersonalRate, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	tlPoolR, err := sb.resolver.Resolve(ctx, input.TeamLeadID, input.TeamLeadTeamID,
		CommissionTypeTeamLeadPoolRate, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	// company_rate is always global — no user/team override.
	companyR, err := sb.resolver.Resolve(ctx, nil, nil, CommissionTypeCompanyRate, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	// ── Build snapshot_json (human-readable backup) ───────────────────────────

	snapshotData := map[string]interface{}{
		"resolved_at": at.Format(time.RFC3339Nano),
		"seller": map[string]interface{}{
			"rate":      sellerR.Rate,
			"source":    sellerR.Source,
			"config_id": sellerR.ConfigID,
		},
		"manager_team": map[string]interface{}{
			"rate":      mgrTeamR.Rate,
			"source":    mgrTeamR.Source,
			"config_id": mgrTeamR.ConfigID,
		},
		"manager_personal": map[string]interface{}{
			"rate":      mgrPersonalR.Rate,
			"source":    mgrPersonalR.Source,
			"config_id": mgrPersonalR.ConfigID,
		},
		"team_lead_pool": map[string]interface{}{
			"rate":      tlPoolR.Rate,
			"source":    tlPoolR.Source,
			"config_id": tlPoolR.ConfigID,
		},
		"company": map[string]interface{}{
			"rate":      companyR.Rate,
			"source":    companyR.Source,
			"config_id": companyR.ConfigID,
		},
		"delivery_fee": input.DeliveryFee,
	}

	jsonBytes, err := json.Marshal(snapshotData)
	if err != nil {
		return nil, fmt.Errorf("snapshot: marshal json: %w", err)
	}

	// ── Assemble the snapshot struct ──────────────────────────────────────────

	s := &OrderFinancialSnapshot{
		ID:      uuid.New(),
		OrderID: input.OrderID,

		SellerRate:          sellerR.Rate,
		ManagerTeamRate:     mgrTeamR.Rate,
		ManagerPersonalRate: mgrPersonalR.Rate,
		TeamLeadPoolRate:    tlPoolR.Rate,
		CompanyRate:         companyR.Rate,

		DeliveryFee: input.DeliveryFee,

		SellerRateSource:          sellerR.Source,
		ManagerTeamRateSource:     mgrTeamR.Source,
		ManagerPersonalRateSource: mgrPersonalR.Source,
		TeamLeadPoolRateSource:    tlPoolR.Source,
		CompanyRateSource:         companyR.Source,

		SellerConfigID:          &sellerR.ConfigID,
		ManagerTeamConfigID:     &mgrTeamR.ConfigID,
		ManagerPersonalConfigID: &mgrPersonalR.ConfigID,
		TeamLeadPoolConfigID:    &tlPoolR.ConfigID,
		CompanyConfigID:         &companyR.ConfigID,

		SnapshotJSON: jsonBytes,
	}

	return s, nil
}
