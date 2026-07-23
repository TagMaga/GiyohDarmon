package compensation

// income_service.go — Service methods for Phase 14 income reporting.
//
// Permission matrix enforced here (not in handler):
//
//   GetMyIncome:
//     owner, seller, manager, sales_team_lead → self only
//     dispatcher/courier/warehouse            → forbidden
//
//   GetUserIncome (target != self):
//     owner                → any user
//     manager              → sellers whose orders have manager_id = actorID
//     sales_team_lead      → users whose orders have team_lead_id = actorID
//     seller               → forbidden
//     other roles          → forbidden
//
//   GetTeamIncome:
//     owner                → any team_lead_id
//     sales_team_lead      → only own team (actorID == teamLeadID)
//     other roles          → forbidden

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

// ─── Public service methods ───────────────────────────────────────────────────

// GetMyIncome returns the income report for the authenticated user.
func (s *Service) GetMyIncome(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	params IncomeQueryParams,
) (*IncomeReportResponse, error) {
	switch actorRole {
	case "owner", "seller", "manager", "sales_team_lead":
		// Allowed.
	default:
		return nil, apperrors.Forbidden("income reports are not available for role: " + actorRole)
	}
	return s.buildIncomeReport(ctx, actorID, params)
}

// GetUserIncome returns the income report for a target user with RBAC enforcement.
func (s *Service) GetUserIncome(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	targetUserID uuid.UUID,
	params IncomeQueryParams,
) (*IncomeReportResponse, error) {
	if err := s.checkUserIncomeAccess(ctx, actorID, actorRole, targetUserID); err != nil {
		return nil, err
	}
	return s.buildIncomeReport(ctx, targetUserID, params)
}

// GetTeamIncome returns aggregated income for all members under a team lead.
// :id in the route is the team lead's user_id (not a team_id UUID).
func (s *Service) GetTeamIncome(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	teamLeadID uuid.UUID,
	params IncomeQueryParams,
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

	from, to, err := parsePeriod(params.From, params.To, s.loc)
	if err != nil {
		return nil, apperrors.BadRequest(err.Error())
	}

	rows, err := s.repo.GetTeamIncomeSummary(ctx, teamLeadID, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	return buildTeamReport(teamLeadID, from, to, rows), nil
}

// ListEvents returns paginated financial events with multi-filter support.
// Non-owner roles can only see their own events (user_id forced to actorID).
// owner can see all events and include company_revenue_earned.
func (s *Service) ListEvents(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	filter FinancialEventFilter,
	p pagination.Params,
) ([]FinancialEvent, int, error) {
	if err := applyEventRoleFilter(actorID, actorRole, &filter); err != nil {
		return nil, 0, err
	}

	events, total, err := s.repo.ListFinancialEventsByFilter(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return events, total, nil
}

// applyEventRoleFilter mutates filter in-place based on the caller's role.
// Extracted for unit-testability.
//
//	owner              → IncludeCompany=true; UserID unchanged (owner can query all)
//	seller/manager/tl  → UserID forced to actorID; IncludeCompany=false
//	other              → returns Forbidden error
func applyEventRoleFilter(actorID uuid.UUID, actorRole string, filter *FinancialEventFilter) error {
	switch actorRole {
	case "owner":
		filter.IncludeCompany = true
	case "seller", "manager", "sales_team_lead":
		filter.UserID = &actorID
		filter.IncludeCompany = false
	default:
		return apperrors.Forbidden("financial events are not accessible for role: " + actorRole)
	}
	return nil
}

// ─── Private helpers ──────────────────────────────────────────────────────────

// checkUserIncomeAccess enforces RBAC for cross-user income reads.
func (s *Service) checkUserIncomeAccess(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole string,
	targetUserID uuid.UUID,
) error {
	// Self-access is always allowed for permitted roles.
	if actorID == targetUserID {
		switch actorRole {
		case "owner", "seller", "manager", "sales_team_lead":
			return nil
		default:
			return apperrors.Forbidden("income reports are not available for role: " + actorRole)
		}
	}

	// Cross-user access rules.
	switch actorRole {
	case "owner":
		return nil

	case "seller":
		return apperrors.Forbidden("sellers can only view their own income")

	case "manager":
		ok, err := s.repo.CanManagerAccessUser(ctx, actorID, targetUserID)
		if err != nil {
			return apperrors.Internal(err)
		}
		if !ok {
			return apperrors.Forbidden("managers can only view income of sellers under their management")
		}
		return nil

	case "sales_team_lead":
		ok, err := s.repo.CanTeamLeadAccessUser(ctx, actorID, targetUserID)
		if err != nil {
			return apperrors.Internal(err)
		}
		if !ok {
			return apperrors.Forbidden("team leads can only view income of their team members")
		}
		return nil

	default:
		return apperrors.Forbidden("income reports are not available for role: " + actorRole)
	}
}

// buildIncomeReport fetches aggregated data and assembles the IncomeReportResponse.
func (s *Service) buildIncomeReport(
	ctx context.Context,
	userID uuid.UUID,
	params IncomeQueryParams,
) (*IncomeReportResponse, error) {
	from, to, err := parsePeriod(params.From, params.To, s.loc)
	if err != nil {
		return nil, apperrors.BadRequest(err.Error())
	}

	filter := FinancialEventFilter{
		From: &from,
		To:   &to,
	}
	if params.EventType != "" {
		filter.EventType = FinancialEventType(params.EventType)
	}

	// 1. Total income + distinct orders count.
	totalIncome, ordersCount, err := s.repo.GetUserIncomeTotal(ctx, userID, filter)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	// 2. Per-event-type breakdown.
	aggRows, err := s.repo.GetUserIncomeByType(ctx, userID, filter)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	orderTotals, err := s.repo.GetUserIncomeOrderTotals(ctx, userID, filter)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	byType := make(IncomeByType, len(aggRows))
	for _, row := range aggRows {
		byType[row.EventType] = row.Total
	}

	avg := 0.0
	if ordersCount > 0 {
		avg = round2(totalIncome / float64(ordersCount))
	}

	resp := &IncomeReportResponse{
		UserID:             userID,
		PeriodStart:        from,
		PeriodEnd:          to,
		TotalIncome:        round2(totalIncome),
		TotalRevenue:       round2(orderTotals.TotalRevenue),
		TotalDeliveryFee:   round2(orderTotals.TotalDeliveryFee),
		TotalCourierPayout: round2(orderTotals.TotalCourierPayout),
		NetProfit:          round2(totalIncome),
		OrdersCount:        ordersCount,
		DeliveredCount:     ordersCount, // only delivered orders emit financial events
		AveragePerOrder:    avg,
		ByEventType:        byType,
	}

	// 3. Optional enriched events list.
	if params.IncludeEvents {
		p := pagination.Params{Page: 1, Limit: 100}
		eventRows, _, err := s.repo.GetUserIncomeEvents(ctx, userID, filter, p)
		if err != nil {
			return nil, apperrors.Internal(err)
		}
		events := make([]IncomeEventResponse, len(eventRows))
		for i, r := range eventRows {
			events[i] = IncomeEventResponse{
				ID:            r.ID,
				OrderID:       r.OrderID,
				EventType:     r.EventType,
				Amount:        r.Amount,
				CreatedAt:     r.CreatedAt,
				OrderNumber:   r.OrderNumber,
				OrderType:     r.OrderType,
				NetRevenue:    r.NetRevenue,
				TotalAmount:   r.TotalAmount,
				DeliveryFee:   r.DeliveryFee,
				CourierPayout: r.CourierPayout,
			}
		}
		resp.Events = events
	}

	return resp, nil
}

// buildTeamReport assembles TeamIncomeResponse from raw DB rows.
// Exported as a free function so income_test.go can unit-test the assembly logic.
func buildTeamReport(
	teamLeadID uuid.UUID,
	from, to time.Time,
	rows []teamMemberIncomeRow,
) *TeamIncomeResponse {
	memberMap := map[uuid.UUID]*TeamMemberIncome{}
	teamTotal := 0.0
	teamOrdersMax := 0
	teamByType := IncomeByType{}

	for _, row := range rows {
		m, ok := memberMap[row.UserID]
		if !ok {
			m = &TeamMemberIncome{
				UserID:      row.UserID,
				ByEventType: IncomeByType{},
			}
			memberMap[row.UserID] = m
		}
		m.ByEventType[row.EventType] = round2(m.ByEventType[row.EventType] + row.Total)
		m.TotalIncome = round2(m.TotalIncome + row.Total)
		if row.OrdersCount > m.OrdersCount {
			m.OrdersCount = row.OrdersCount
		}

		teamTotal = round2(teamTotal + row.Total)
		if row.OrdersCount > teamOrdersMax {
			teamOrdersMax = row.OrdersCount
		}
		teamByType[row.EventType] = round2(teamByType[row.EventType] + row.Total)
	}

	members := make([]TeamMemberIncome, 0, len(memberMap))
	for _, m := range memberMap {
		members = append(members, *m)
	}

	return &TeamIncomeResponse{
		TeamLeadID:  teamLeadID,
		PeriodStart: from,
		PeriodEnd:   to,
		TotalIncome: teamTotal,
		OrdersCount: teamOrdersMax,
		ByEventType: teamByType,
		Members:     members,
	}
}

// ─── Period helpers ───────────────────────────────────────────────────────────

// ParsePeriod is the exported form of parsePeriod, for callers outside this
// package (e.g. internal/payouts, which reuses this instead of re-deriving
// its own period-parsing logic) that need the same [from, to) semantics
// this service already applies to its own income queries.
func (s *Service) ParsePeriod(fromStr, toStr string) (time.Time, time.Time, error) {
	return parsePeriod(fromStr, toStr, s.loc)
}

// parsePeriod parses optional YYYY-MM-DD strings into a [from, to) range.
// Bare YYYY-MM-DD strings are treated as midnight in loc (so "today"/"this
// month" means the local business day/month, not the UTC day/month) —
// mirrors internal/finance/handler.go's parsePeriod. Without this, a seller
// whose commission was earned in the early hours of the local day (e.g.
// Dushanbe, UTC+5) could have that financial_events row land in what UTC
// still considers "yesterday", silently excluding it from "today"'s report.
// Returns start-of-current-month → end-of-today when both strings are empty.
func parsePeriod(fromStr, toStr string, loc *time.Location) (time.Time, time.Time, error) {
	if loc == nil {
		loc = time.UTC
	}
	from, to := defaultPeriod(loc)
	if fromStr != "" {
		t, err := parseLocalDate(fromStr, loc)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid from date %q (use YYYY-MM-DD)", fromStr)
		}
		from = t.UTC()
	}
	if toStr != "" {
		t, err := parseLocalDate(toStr, loc)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid to date %q (use YYYY-MM-DD)", toStr)
		}
		// Include the full end day.
		to = t.Add(24*time.Hour - time.Nanosecond).UTC()
	}
	return from, to, nil
}

// parseLocalDate parses a bare YYYY-MM-DD string as midnight in loc (not UTC).
func parseLocalDate(s string, loc *time.Location) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc), nil
}

// defaultPeriod returns (start of current month, end of today) in loc,
// converted to UTC for use as query bounds against UTC-stored timestamps.
func defaultPeriod(loc *time.Location) (time.Time, time.Time) {
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	end := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, loc)
	return start.UTC(), end.UTC()
}
