package orders

// financial.go — Financial Engine for Phase 4.
//
// Emits immutable FinancialEvent ledger entries when an order is delivered.
//
// Commission model:
//   All commissions derive from commission_base = total_amount + delivery_fee - courier_payout.
//   Delivery-fee revenue is included in the base (net of what the courier is paid),
//   so the company/seller also earn their normal share of the delivery margin.
//
//   team_lead_pool_gross is a fixed percentage of commission_base
//   (team_lead_pool_rate). Sellers and managers are paid OUT OF this pool —
//   their commissions are subtracted from it to leave the team lead's net take.
//
//   company_revenue is RESIDUAL:
//     company_revenue = commission_base - team_lead_pool_gross
//
//   This guarantees:
//     company + seller + manager + team_lead_pool == commission_base  (exactly, for every order)
//
// Per-order-type rules:
//
//   seller_order:
//     team_lead_pool_gross         = commission_base × team_lead_pool_rate
//     seller_commission            = commission_base × seller_rate
//     manager_team_commission      = commission_base × manager_team_rate
//     manager_personal_commission  = 0
//     team_lead_pool (net)         = team_lead_pool_gross - seller - manager_team
//     company_revenue (residual)   = commission_base - team_lead_pool_gross
//
//   manager_personal_order:
//     team_lead_pool_gross         = commission_base × team_lead_pool_rate
//     seller_commission            = 0
//     manager_team_commission      = 0  (manager cannot double-pay himself)
//     manager_personal_commission  = commission_base × manager_personal_rate
//     team_lead_pool (net)         = team_lead_pool_gross - manager_personal
//     company_revenue (residual)   = commission_base - team_lead_pool_gross
//
//   team_lead_personal_order:
//     team_lead_pool_gross         = commission_base × team_lead_pool_rate
//     seller_commission            = 0
//     manager_team_commission      = commission_base × manager_team_rate
//     manager_personal_commission  = 0
//     team_lead_pool (net)         = team_lead_pool_gross - manager_team
//     company_revenue (residual)   = commission_base - team_lead_pool_gross
//
// company_rate is stored for display/history but not used in the calculation.
// Zero-amount events are never written to the ledger.

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
	"gorm.io/gorm"
)

// eventSpec defines one ledger entry to be emitted.
type eventSpec struct {
	eventType compensation.FinancialEventType
	userID    *uuid.UUID // nil for company events or unresolved hierarchy
	amount    float64
}

// emitFinancialEvents writes all commission ledger entries for a delivered order.
// Must be called inside the status-change transaction.
//
// Parameters:
//
//	order — the delivered order (must have NetRevenue, SnapshotID, OrderType set)
//	snap  — the frozen snapshot for this order
func (s *Service) emitFinancialEvents(
	ctx context.Context,
	tx *gorm.DB,
	order *Order,
	snap *compensation.OrderFinancialSnapshot,
) error {
	// Business rule: courier is paid first; commissions are split from the remainder.
	// Resolve and freeze courier_payout before commission calculation so the base is
	// correct even when the payout was not frozen at order-creation time.
	if order.CourierID != nil && order.CourierPayout == 0 {
		resolved, err := logistics_settings.ResolveCourierPayout(
			tx, *order.CourierID, order.DeliveryMethod, order.TotalAmount,
		)
		if err != nil {
			return fmt.Errorf("resolve courier payout: %w", err)
		}
		if resolved > 0 {
			if err := tx.WithContext(ctx).Model(&Order{}).
				Where("id = ?", order.ID).
				UpdateColumn("courier_payout", resolved).Error; err != nil {
				return fmt.Errorf("freeze courier payout: %w", err)
			}
			order.CourierPayout = resolved
		}
	}

	commissionBase := order.TotalAmount + order.DeliveryFee - order.CourierPayout
	if commissionBase < 0 {
		return fmt.Errorf("financial engine: courier_payout %.2f exceeds total_amount+delivery_fee %.2f", order.CourierPayout, order.TotalAmount+order.DeliveryFee)
	}

	// Compute the full breakdown using the canonical business-rule function.
	// This is the same function used by the Preview endpoint — single source of truth.
	breakdown, err := compensation.ApplyCommissionRules(
		compensation.OrderType(order.OrderType), commissionBase, snap,
	)
	if err != nil {
		return fmt.Errorf("financial engine: %w", err)
	}

	// Helper: safely take address of a uuid.UUID.
	ptrOf := func(id uuid.UUID) *uuid.UUID { v := id; return &v }

	// Build event specs from the computed breakdown.
	// The order type determines which participants receive which amounts.
	var specs []eventSpec

	switch order.OrderType {

	case OrderTypeSeller:
		// seller_order: company + seller + manager_team + team_lead_pool(residual)
		specs = []eventSpec{
			{compensation.EventCompanyRevenueEarned, nil, breakdown.CompanyRevenue},
			{compensation.EventSellerCommissionEarned, ptrOf(order.SellerID), breakdown.SellerCommission},
			{compensation.EventManagerTeamCommissionEarned, order.ManagerID, breakdown.ManagerTeamCommission},
			{compensation.EventTeamLeadPoolEarned, order.TeamLeadID, breakdown.TeamLeadPool},
		}

	case OrderTypeManagerPersonal:
		// manager_personal_order: company + manager_personal + team_lead_pool(residual)
		// seller_id IS the manager (they created the order).
		specs = []eventSpec{
			{compensation.EventCompanyRevenueEarned, nil, breakdown.CompanyRevenue},
			{compensation.EventManagerPersonalCommissionEarned, ptrOf(order.SellerID), breakdown.ManagerPersonalCommission},
			{compensation.EventTeamLeadPoolEarned, order.TeamLeadID, breakdown.TeamLeadPool},
		}

	case OrderTypeTeamLeadPersonal:
		// team_lead_personal_order: company + manager_team + team_lead_pool(residual)
		// seller_id IS the team lead (they created the order).
		specs = []eventSpec{
			{compensation.EventCompanyRevenueEarned, nil, breakdown.CompanyRevenue},
			{compensation.EventManagerTeamCommissionEarned, order.ManagerID, breakdown.ManagerTeamCommission},
			{compensation.EventTeamLeadPoolEarned, ptrOf(order.SellerID), breakdown.TeamLeadPool},
		}

	case OrderTypeHouse:
		// house_order: company revenue only — no seller/manager/team-lead
		// attribution, so no one earns a commission on it.
		specs = []eventSpec{
			{compensation.EventCompanyRevenueEarned, nil, breakdown.CompanyRevenue},
		}

	default:
		return fmt.Errorf("financial engine: unknown order type %q", order.OrderType)
	}

	// Build shared metadata once (attached to every event for audit traceability).
	metaBytes, _ := json.Marshal(map[string]interface{}{
		"order_id":        order.ID,
		"order_type":      order.OrderType,
		"total_amount":    order.TotalAmount,
		"delivery_fee":    order.DeliveryFee,
		"net_revenue":     order.NetRevenue,
		"courier_payout":  order.CourierPayout,
		"commission_base": commissionBase,
		"breakdown": map[string]interface{}{
			"company_revenue":             breakdown.CompanyRevenue,
			"seller_commission":           breakdown.SellerCommission,
			"manager_team_commission":     breakdown.ManagerTeamCommission,
			"manager_personal_commission": breakdown.ManagerPersonalCommission,
			"team_lead_pool":              breakdown.TeamLeadPool,
		},
	})

	for _, spec := range specs {
		if spec.amount == 0 {
			continue // never write zero-amount events
		}
		meta := make([]byte, len(metaBytes))
		copy(meta, metaBytes)

		event := &compensation.FinancialEvent{
			ID:         uuid.New(),
			OrderID:    order.ID, // Phase 25: value type — NOT NULL enforced at DB + model level
			SnapshotID: order.SnapshotID,
			EventType:  spec.eventType,
			UserID:     spec.userID,
			Amount:     spec.amount,
			Metadata:   &meta,
		}
		if err := s.compSvc.RecordFinancialEvent(ctx, tx, event); err != nil {
			return fmt.Errorf("emit financial event %s: %w", spec.eventType, err)
		}
	}

	// ── Courier payout (paid from company margin; separate from commissions) ──
	// The courier earns their frozen payout only on a delivered order. This is an
	// independent concept from the client delivery fee. Emitted once (idempotent).
	if err := s.emitCourierFeeEvent(ctx, tx, order); err != nil {
		return err
	}

	// Company Budget's balance is computed live from financial_events + Finance's
	// business expenses (internal/finance.Repository.GetNetProfit) — it is never
	// written here per-order, since true net profit depends on product cost and
	// business expenses that aren't known at the time any single order is delivered.

	return nil
}

// emitCourierFeeEvent records a courier_fee_earned ledger entry for a delivered
// order using the frozen orders.courier_payout. If the payout was never frozen
// (legacy order) it is resolved and frozen now. Idempotent: never emits twice.
func (s *Service) emitCourierFeeEvent(ctx context.Context, tx *gorm.DB, order *Order) error {
	if order.CourierID == nil {
		return nil // no courier → no payout
	}

	payout := order.CourierPayout
	if payout == 0 {
		// Legacy/unfrozen: resolve from the courier's tariff and freeze it.
		resolved, err := logistics_settings.ResolveCourierPayout(tx, *order.CourierID, order.DeliveryMethod, order.TotalAmount)
		if err != nil {
			return fmt.Errorf("resolve courier payout: %w", err)
		}
		if resolved > 0 {
			payout = resolved
			if err := tx.WithContext(ctx).Model(&Order{}).Where("id = ?", order.ID).
				UpdateColumn("courier_payout", payout).Error; err != nil {
				return fmt.Errorf("freeze courier payout: %w", err)
			}
			order.CourierPayout = payout
		}
	}
	if payout <= 0 {
		return nil
	}

	// Idempotency guard — never duplicate the courier earning.
	var existing int64
	if err := tx.WithContext(ctx).Model(&compensation.FinancialEvent{}).
		Where("order_id = ? AND event_type = ?", order.ID, compensation.EventCourierFeeEarned).
		Count(&existing).Error; err != nil {
		return fmt.Errorf("check existing courier event: %w", err)
	}
	if existing > 0 {
		return nil
	}

	meta, _ := json.Marshal(map[string]interface{}{
		"order_id":        order.ID,
		"courier_id":      order.CourierID,
		"delivery_method": order.DeliveryMethod,
		"courier_payout":  payout,
	})
	event := &compensation.FinancialEvent{
		ID:         uuid.New(),
		OrderID:    order.ID,
		SnapshotID: order.SnapshotID,
		EventType:  compensation.EventCourierFeeEarned,
		UserID:     order.CourierID,
		Amount:     payout,
		Metadata:   &meta,
	}
	if err := s.compSvc.RecordFinancialEvent(ctx, tx, event); err != nil {
		return fmt.Errorf("emit courier_fee_earned: %w", err)
	}
	return nil
}
