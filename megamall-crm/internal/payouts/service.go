package payouts

import (
	"context"
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
// already applies that check.
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

	members := make([]PayableMember, 0, len(teamIncome.Members))
	var teamEarned, teamPaid float64
	for _, m := range teamIncome.Members {
		u := users[m.UserID]
		// GetTeamIncomeSummary sweeps in anyone with a financial_events row
		// tied to this team's orders — that includes couriers (courier_fee_earned)
		// and the team lead's own team_lead_pool_earned row. Payables is only
		// ever managers/sellers; the team lead's own pool is reported
		// separately via PersonalPool/PersonalNet above.
		if u.Role != "manager" && u.Role != "seller" {
			continue
		}
		gt := grossTotals[m.UserID]
		paid := alreadyPaid[m.UserID]
		remaining := m.TotalIncome - paid
		if remaining < 0 {
			remaining = 0
		}
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
	// personalPool (sum of team_lead_pool_earned events) is already the team
	// lead's net take-home — ApplyCommissionRules computes it as
	// poolGross - seller - manager *per order*, before the event is ever
	// written. It must NOT be reduced again by payouts already made to staff:
	// that money was never the team lead's to begin with, so subtracting it
	// here would double-count the same commission. (Previously this did
	// `personalPool - allPaid`, which was wrong for exactly that reason.)
	personalNet := personalPool

	return &PayablesResponse{
		TeamLeadID:    teamLeadID,
		PeriodStart:   from.Format("2006-01-02"),
		PeriodEnd:     to.Format("2006-01-02"),
		TeamEarned:    teamEarned,
		TeamPaid:      teamPaid,
		TeamRemaining: teamEarned - teamPaid,
		PersonalPool:  personalPool,
		PersonalNet:   personalNet,
		Members:       members,
	}, nil
}

// CreatePayouts validates and bulk-inserts a Team Lead's "Выплатить" action.
// Scope: only sales_team_lead (paying their own team) and owner (unrestricted)
// may create payouts today — manager-pays-seller is left for a future pass
// since no shipping screen drives it yet, even though the payee/payer_role
// columns already support it.
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
	// "who is payable," not a second hand-rolled hierarchy check.
	var allowed map[uuid.UUID]bool
	if actorRole == "sales_team_lead" {
		payables, err := s.GetPayablesForTeamLead(ctx, actorID, actorRole, actorID, req.PeriodStart, req.PeriodEnd)
		if err != nil {
			return nil, err
		}
		allowed = make(map[uuid.UUID]bool, len(payables.Members))
		for _, m := range payables.Members {
			allowed[m.PayeeID] = true
		}
	}

	rows := make([]*Payout, 0, len(req.Items))
	for _, item := range req.Items {
		if actorRole == "sales_team_lead" && !allowed[item.PayeeID] {
			return nil, apperrors.Forbidden(fmt.Sprintf("payee %s is not a member of your team for this period", item.PayeeID))
		}
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

	if err := s.repo.CreateBatch(ctx, rows); err != nil {
		return nil, apperrors.Internal(err)
	}

	out := make([]PayoutResponse, len(rows))
	for i, row := range rows {
		out[i] = ToResponse(row)
	}
	return out, nil
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
