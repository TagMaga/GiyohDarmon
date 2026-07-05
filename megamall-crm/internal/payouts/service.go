package payouts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	apperrors "github.com/megamall/crm/pkg/errors"
)

// Service holds payout business logic. It depends on compensation.Service for
// the earned-income numbers (financial_events are compensation's domain) —
// payouts never re-derives commission math, it only tracks money actually
// handed over and nets it against what compensation already knows was earned.
type Service struct {
	repo    *Repository
	compSvc *compensation.Service
}

func NewService(repo *Repository, compSvc *compensation.Service) *Service {
	return &Service{repo: repo, compSvc: compSvc}
}

// GetMyPayouts returns the authenticated user's payouts received (as payee).
func (s *Service) GetMyPayouts(ctx context.Context, userID uuid.UUID) ([]PayoutResponse, error) {
	rows, err := s.repo.ListByPayee(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	out := make([]PayoutResponse, len(rows))
	for i := range rows {
		out[i] = ToResponse(&rows[i])
	}
	return out, nil
}

// GetPayablesForTeamLead builds the "Кому выплатить" list + hero numbers for
// a team lead's Финансы screen. RBAC mirrors compensation.GetTeamIncome
// exactly (owner may view any team; a team lead may only view their own) —
// enforced by delegating the income lookup to compSvc.GetTeamIncome, which
// already applies that check. All I/O happens here; the aggregation itself
// is the pure, unit-testable buildPayablesResponse below.
func (s *Service) GetPayablesForTeamLead(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	teamLeadID uuid.UUID,
	fromStr, toStr string,
) (*PayablesResponse, error) {
	from, to, err := parsePeriod(fromStr, toStr)
	if err != nil {
		return nil, apperrors.BadRequest(err.Error())
	}

	teamIncome, err := s.compSvc.GetTeamIncome(ctx, actorID, actorRole, teamLeadID, compensation.IncomeQueryParams{
		From: from.Format("2006-01-02"),
		To:   to.Format("2006-01-02"),
	})
	if err != nil {
		return nil, err // already an *apperrors.AppError with correct RBAC status
	}

	// Team lead's own personal pool income (team_lead_pool_earned only).
	myIncome, err := s.compSvc.GetMyIncome(ctx, teamLeadID, "sales_team_lead", compensation.IncomeQueryParams{
		From: from.Format("2006-01-02"),
		To:   to.Format("2006-01-02"),
	})
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	personalPool := myIncome.ByEventType["team_lead_pool_earned"]

	grossTotals, err := s.repo.GetTeamOrderGrossTotals(ctx, teamLeadID, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	alreadyPaid, err := s.repo.SumPaidGroupedByPayee(ctx, teamLeadID, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	memberIDs := make([]uuid.UUID, 0, len(teamIncome.Members))
	for _, m := range teamIncome.Members {
		memberIDs = append(memberIDs, m.UserID)
	}
	users, err := s.repo.GetUsersByIDs(ctx, memberIDs)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	return buildPayablesResponse(teamLeadID, from, to, teamIncome.Members, users, grossTotals, alreadyPaid, personalPool), nil
}

// buildPayablesResponse is the pure aggregation step behind
// GetPayablesForTeamLead — no I/O, so it can be unit tested without a
// database (mirrors compensation/income_service.go's buildTeamReport).
func buildPayablesResponse(
	teamLeadID uuid.UUID,
	from, to time.Time,
	teamMembers []compensation.TeamMemberIncome,
	users map[uuid.UUID]userInfo,
	grossTotals map[uuid.UUID]orderTotalsRow,
	alreadyPaid map[uuid.UUID]float64,
	personalPool float64,
) *PayablesResponse {
	members := make([]PayableMember, 0, len(teamMembers))
	var teamEarned, teamPaid float64
	for _, m := range teamMembers {
		u := users[m.UserID]
		// GetTeamIncomeSummary sweeps in anyone with a financial_events row
		// tied to this team's orders — that includes couriers (courier_fee_earned)
		// and the team lead's own team_lead_pool_earned row. Payables is only
		// ever managers/sellers; the team lead's own pool is reported
		// separately via PersonalPool/PersonalNet.
		if u.Role != "manager" && u.Role != "seller" {
			continue
		}
		gt := grossTotals[m.UserID]
		paid := alreadyPaid[m.UserID]
		remaining := computeRemaining(m.TotalIncome, paid)
		members = append(members, PayableMember{
			PayeeID:     m.UserID,
			FullName:    u.FullName,
			Role:        u.Role,
			OrdersCount: gt.OrdersCount,
			GrossAmount: gt.GrossAmount,
			Earned:      m.TotalIncome,
			AlreadyPaid: paid,
			Remaining:   remaining,
		})
		teamEarned += m.TotalIncome
		teamPaid += paid
	}

	return &PayablesResponse{
		TeamLeadID:  teamLeadID,
		PeriodStart: from.Format("2006-01-02"),
		PeriodEnd:   to.Format("2006-01-02"),
		TeamEarned:  teamEarned,
		TeamPaid:    teamPaid,
		// personalPool (sum of team_lead_pool_earned events) is already the
		// team lead's net take-home — ApplyCommissionRules computes it as
		// poolGross - seller - manager *per order*, before the event is ever
		// written. PersonalNet must NOT be reduced again by payouts already
		// made to staff: that money was never the team lead's to begin with.
		TeamRemaining: teamEarned - teamPaid,
		PersonalPool:  personalPool,
		PersonalNet:   personalPool,
		Members:       members,
	}
}

// computeRemaining floors "earned minus already paid" at 0.
func computeRemaining(earned, paid float64) float64 {
	r := earned - paid
	if r < 0 {
		return 0
	}
	return r
}

// validatePayoutItems is the pure guard behind CreatePayouts: every payee
// must be in the caller's own payables list (when restricted — i.e. the
// caller is a team lead, not owner), and no item's amount may exceed what's
// actually owed. This is the amount ceiling that was previously missing
// entirely — a team lead could submit any amount for a valid payee.
func validatePayoutItems(items []CreatePayoutItem, allowed map[uuid.UUID]PayableMember, restricted bool) error {
	const epsilon = 0.01 // float rounding tolerance
	for _, item := range items {
		if !restricted {
			continue // owner: unrestricted, no "remaining" ceiling to check against
		}
		m, ok := allowed[item.PayeeID]
		if !ok {
			return apperrors.Forbidden(fmt.Sprintf("payee %s is not a member of your team for this period", item.PayeeID))
		}
		if item.Amount > m.Remaining+epsilon {
			return apperrors.BadRequest(fmt.Sprintf(
				"amount %.2f for %s exceeds remaining %.2f — cannot pay more than what's owed",
				item.Amount, m.FullName, m.Remaining,
			))
		}
	}
	return nil
}

// GetPayeePayoutHistory returns payout history for one payee, restricted to
// payouts the calling team lead actually made (never another payer's records)
// — mirrors the "your own team only" restriction already applied in
// CreatePayouts/validatePayoutItems. Owner sees everything for the payee.
func (s *Service) GetPayeePayoutHistory(ctx context.Context, actorID uuid.UUID, actorRole string, payeeID uuid.UUID) ([]PayoutResponse, error) {
	if actorRole != "owner" && actorRole != "sales_team_lead" {
		return nil, apperrors.Forbidden("only a team lead or owner can view payout history")
	}
	rows, err := s.repo.ListByPayee(ctx, payeeID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	out := make([]PayoutResponse, 0, len(rows))
	for i := range rows {
		if actorRole == "sales_team_lead" && rows[i].PayerID != actorID {
			continue
		}
		out = append(out, ToResponse(&rows[i]))
	}
	return out, nil
}

// CreatePayouts validates and bulk-inserts a Team Lead's "Выплатить" action.
// Scope: only sales_team_lead (paying their own team) and owner (unrestricted)
// may create payouts today — manager-pays-seller is left for a future pass:
// RequireRoles already excludes "manager" at the route level (see routes.go),
// so there is no half-built code path implying the capability exists yet,
// even though the payee/payer_role columns are generic enough to support it
// whenever a Manager-facing Финансы screen is built.
//
// Idempotent: req.IdempotencyKey + actorID must be unique. A retried request
// (network retry, double-click) with the same key replays the original
// batch's result instead of creating a second set of payouts.
func (s *Service) CreatePayouts(ctx context.Context, actorID uuid.UUID, actorRole string, req CreatePayoutsRequest) ([]PayoutResponse, error) {
	if actorRole != "owner" && actorRole != "sales_team_lead" {
		return nil, apperrors.Forbidden("only a team lead or owner can create payouts")
	}

	periodStart, err := time.Parse("2006-01-02", req.PeriodStart)
	if err != nil {
		return nil, apperrors.BadRequest("invalid period_start (use YYYY-MM-DD)")
	}
	periodEnd, err := time.Parse("2006-01-02", req.PeriodEnd)
	if err != nil {
		return nil, apperrors.BadRequest("invalid period_end (use YYYY-MM-DD)")
	}
	if periodEnd.Before(periodStart) {
		return nil, apperrors.BadRequest("period_end must not be before period_start")
	}

	// Team leads may only pay members that actually show up in their own
	// payables list for this period — reuses the exact same RBAC + team
	// scoping as the payables endpoint, so there's one source of truth for
	// "who is payable" and "how much do they have left."
	restricted := actorRole == "sales_team_lead"
	var allowed map[uuid.UUID]PayableMember
	if restricted {
		payables, err := s.GetPayablesForTeamLead(ctx, actorID, actorRole, actorID, req.PeriodStart, req.PeriodEnd)
		if err != nil {
			return nil, err
		}
		allowed = make(map[uuid.UUID]PayableMember, len(payables.Members))
		for _, m := range payables.Members {
			allowed[m.PayeeID] = m
		}
	}

	if err := validatePayoutItems(req.Items, allowed, restricted); err != nil {
		return nil, err
	}

	rows := make([]*Payout, 0, len(req.Items))
	for _, item := range req.Items {
		payeeRole, err := s.repo.GetUserRole(ctx, item.PayeeID)
		if err != nil || payeeRole == "" {
			return nil, apperrors.BadRequest(fmt.Sprintf("payee %s not found", item.PayeeID))
		}
		var method *string
		if req.Method != "" {
			m := req.Method
			method = &m
		}
		var note *string
		if req.Note != "" {
			n := req.Note
			note = &n
		}
		rows = append(rows, &Payout{
			ID:          uuid.New(),
			PayeeID:     item.PayeeID,
			PayeeRole:   payeeRole,
			PayerID:     actorID,
			PayerRole:   actorRole,
			Amount:      item.Amount,
			PeriodStart: periodStart,
			PeriodEnd:   periodEnd,
			Method:      method,
			Status:      "paid",
			Note:        note,
		})
	}

	batch := &PayoutBatch{ID: uuid.New(), PayerID: actorID, IdempotencyKey: req.IdempotencyKey}
	err = s.repo.CreateBatchIdempotent(ctx, batch, rows)
	if errors.Is(err, ErrDuplicateBatch) {
		existing, ferr := s.repo.FindBatchByKey(ctx, actorID, req.IdempotencyKey)
		if ferr != nil {
			return nil, apperrors.Internal(ferr)
		}
		existingRows, lerr := s.repo.ListByBatchID(ctx, existing.ID)
		if lerr != nil {
			return nil, apperrors.Internal(lerr)
		}
		out := make([]PayoutResponse, len(existingRows))
		for i := range existingRows {
			out[i] = ToResponse(&existingRows[i])
		}
		return out, nil
	}
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	out := make([]PayoutResponse, len(rows))
	for i, row := range rows {
		out[i] = ToResponse(row)
	}
	return out, nil
}

// VoidPayout reverses a payout — a status flag + audit trail, never a hard
// delete, so the ledger stays append-only. Only the original payer or an
// owner may void; already-voided payouts are rejected (not silently no-op),
// so a client can tell a stale double-submit apart from a real void.
func (s *Service) VoidPayout(ctx context.Context, actorID uuid.UUID, actorRole string, payoutID uuid.UUID, reason string) error {
	p, err := s.repo.GetByID(ctx, payoutID)
	if err != nil {
		return apperrors.NotFound("payout not found")
	}
	if actorRole != "owner" && p.PayerID != actorID {
		return apperrors.Forbidden("only the original payer or owner can void a payout")
	}
	if p.Status == "voided" {
		return apperrors.BadRequest("payout is already voided")
	}
	if err := s.repo.Void(ctx, payoutID, actorID, reason); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

// parsePeriod mirrors compensation's income_service.go parsePeriod/defaultPeriod
// (unexported there) — kept in sync deliberately: same default-period semantics
// (start of current month → end of today) so a payables call with no explicit
// range agrees with what GetTeamIncome/GetMyIncome would compute by default.
func parsePeriod(fromStr, toStr string) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, time.UTC)

	if fromStr != "" {
		t, err := time.Parse("2006-01-02", fromStr)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid from date %q (use YYYY-MM-DD)", fromStr)
		}
		from = t.UTC()
	}
	if toStr != "" {
		t, err := time.Parse("2006-01-02", toStr)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid to date %q (use YYYY-MM-DD)", toStr)
		}
		to = t.Add(24*time.Hour - time.Nanosecond).UTC()
	}
	return from, to, nil
}
