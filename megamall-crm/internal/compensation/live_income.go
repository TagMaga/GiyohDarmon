package compensation

// live_income.go — live commission recomputation for not-yet-paid balances.
//
// Problem: financial_events.amount is frozen forever at order-delivery time,
// using whichever CommissionConfig rate was resolved when the order was
// CREATED (OrderFinancialSnapshot). When the owner changes an employee's
// rate, that change never touches already-written events, so a team lead's
// "К выплате" screen kept showing the old percentage/amount even for orders
// that haven't been paid out yet.
//
// Fix: for any order-based financial_event not yet covered by a payout, don't
// trust the stored Amount — recompute it now using ApplyCommissionRules with
// TODAY's rates. Events already covered by a payout are left completely
// untouched (that money was already handed over at whatever amount was
// calculated at the time).
//
// "Already covered by a payout" is determined by comparing an event's
// created_at against the payee's most recent non-voided payout timestamp
// (payouts are always full-balance settlements — see internal/payouts) —
// no schema change needed.

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
)

// breakdownAmountForEvent projects a recomputed CommissionBreakdown back onto
// the specific event type a ledger row was originally written as. Returns
// ok=false for event types this recomputation doesn't apply to (e.g.
// courier_fee_earned, which callers should already have filtered out).
func breakdownAmountForEvent(eventType string, b CommissionBreakdown) (float64, bool) {
	switch FinancialEventType(eventType) {
	case EventSellerCommissionEarned:
		return b.SellerCommission, true
	case EventManagerTeamCommissionEarned:
		return b.ManagerTeamCommission, true
	case EventManagerPersonalCommissionEarned:
		return b.ManagerPersonalCommission, true
	case EventTeamLeadPoolEarned:
		return b.TeamLeadPool, true
	case EventCompanyRevenueEarned:
		return b.CompanyRevenue, true
	default:
		return 0, false
	}
}

// recomputeLiveBreakdown resolves today's commission rates for the
// participants on one order and reapplies the exact same commission math
// used at delivery time (ApplyCommissionRules) — the only difference is the
// rates come from RateResolver.Resolve(..., now) instead of the frozen
// OrderFinancialSnapshot recorded at order creation.
func (s *Service) recomputeLiveBreakdown(ctx context.Context, row teamEventDetailRow, now time.Time) (CommissionBreakdown, error) {
	input := SnapshotInput{
		OrderID:  &row.OrderID,
		SellerID: &row.SellerID,
		// SellerTeamID is always nil at order creation too (orders/service.go) —
		// seller_rate never has a team-level override, only employee/global.
		SellerTeamID:   nil,
		ManagerID:      row.ManagerID,
		ManagerTeamID:  row.ManagerTeamID,
		TeamLeadID:     row.TeamLeadID,
		TeamLeadTeamID: row.TeamLeadTeamID,
		ResolvedAt:     now,
	}
	liveSnap, err := s.snapshot.Build(ctx, input)
	if err != nil {
		return CommissionBreakdown{}, err
	}
	return ApplyCommissionRules(OrderType(row.OrderType), row.NetRevenue, liveSnap, row.ManagerID != nil)
}

// GetTeamIncomeLive returns the same shape as GetTeamIncome, except every
// order-based financial_event not yet covered by a payout is recomputed with
// today's commission rates instead of trusting the frozen historical amount.
//
// paidCutoffs maps payee user_id -> timestamp of their most recent non-voided
// payout (absent/zero = never paid, so every one of their events is "unpaid"
// and gets recomputed live). Computed by the payouts module and passed in as
// a plain map to avoid an import cycle (payouts already depends on
// compensation, not the reverse).
func (s *Service) GetTeamIncomeLive(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	teamLeadID uuid.UUID,
	from, to time.Time,
	paidCutoffs map[uuid.UUID]time.Time,
) (*TeamIncomeResponse, error) {
	switch actorRole {
	case "owner":
		// May query any team.
	case "sales_team_lead":
		if actorID != teamLeadID {
			return nil, apperrors.Forbidden("team leads can only view their own team income")
		}
	default:
		return nil, apperrors.Forbidden("only owner and team leads can view team income")
	}

	detailed, err := s.repo.GetTeamFinancialEventsDetailed(ctx, teamLeadID, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	pharmacyRows, err := s.repo.GetTeamPharmacyIncomeSummary(ctx, teamLeadID, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	now := time.Now().UTC()

	type memberAgg struct {
		byType IncomeByType
		total  float64
		orders map[uuid.UUID]bool
	}
	members := map[uuid.UUID]*memberAgg{}
	getMember := func(id uuid.UUID) *memberAgg {
		m, ok := members[id]
		if !ok {
			m = &memberAgg{byType: IncomeByType{}, orders: map[uuid.UUID]bool{}}
			members[id] = m
		}
		return m
	}

	// nil value = recomputation was attempted for this order and failed
	// (e.g. no active rate configured) — fall back to each row's frozen
	// amount rather than silently zeroing out real money.
	liveCache := map[uuid.UUID]*CommissionBreakdown{}
	allOrders := map[uuid.UUID]bool{}

	for _, row := range detailed {
		amount := row.Amount
		cutoff, hasCutoff := paidCutoffs[row.UserID]
		if !hasCutoff || row.CreatedAt.After(cutoff) {
			b, attempted := liveCache[row.OrderID]
			if !attempted {
				computed, err := s.recomputeLiveBreakdown(ctx, row, now)
				if err == nil {
					b = &computed
				} else {
					// Falls back to the frozen historical amount for every event
					// on this order (below) rather than hiding real money — but
					// that fallback must never be silent. Most likely cause: a
					// rate change put seller/manager rate above team_lead_pool_rate
					// (or another commission_configs gap), the same constraint
					// ApplyCommissionRules enforces at order-delivery time.
					log.Printf("[compensation] live income recompute failed for order %s (team_lead=%v): %v — showing frozen amount instead",
						row.OrderID, row.TeamLeadID, err)
				}
				liveCache[row.OrderID] = b
			}
			if b != nil {
				if live, ok := breakdownAmountForEvent(row.EventType, *b); ok {
					amount = live
				}
			}
		}
		m := getMember(row.UserID)
		m.byType[row.EventType] = round2(m.byType[row.EventType] + amount)
		m.total = round2(m.total + amount)
		m.orders[row.OrderID] = true
		allOrders[row.OrderID] = true
	}

	for _, row := range pharmacyRows {
		m := getMember(row.UserID)
		m.byType[row.EventType] = round2(m.byType[row.EventType] + row.Total)
		m.total = round2(m.total + row.Total)
	}

	teamTotal := 0.0
	teamByType := IncomeByType{}
	respMembers := make([]TeamMemberIncome, 0, len(members))
	for uid, m := range members {
		respMembers = append(respMembers, TeamMemberIncome{
			UserID:      uid,
			TotalIncome: m.total,
			OrdersCount: len(m.orders),
			ByEventType: m.byType,
		})
		teamTotal = round2(teamTotal + m.total)
		for et, v := range m.byType {
			teamByType[et] = round2(teamByType[et] + v)
		}
	}

	return &TeamIncomeResponse{
		TeamLeadID:  teamLeadID,
		PeriodStart: from,
		PeriodEnd:   to,
		TotalIncome: teamTotal,
		OrdersCount: len(allOrders),
		ByEventType: teamByType,
		Members:     respMembers,
	}, nil
}
