package compensation

// income_test.go — Pure unit tests for Phase 14 income reporting logic.
//
// No database, no network required.
// Run with: go test ./internal/compensation/ -v -run TestIncome

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

func near2i(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff < 0.005
}

func mustUUID() uuid.UUID { return uuid.New() }

// ─── Team income report assembly tests ────────────────────────────────────────

// TestBuildTeamReport_AggregatesMembers verifies the team report aggregation.
func TestBuildTeamReport_AggregatesMembers(t *testing.T) {
	tlID := mustUUID()
	seller1 := mustUUID()
	seller2 := mustUUID()
	from := time.Now().Add(-30 * 24 * time.Hour).UTC()
	to := time.Now().UTC()

	rows := []teamMemberIncomeRow{
		{UserID: seller1, EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
		{UserID: seller1, EventType: "manager_team_commission_earned", Total: 2.4, OrdersCount: 1},
		{UserID: seller2, EventType: "seller_commission_earned", Total: 8.0, OrdersCount: 1},
		{UserID: tlID, EventType: "team_lead_pool_earned", Total: 21.6, OrdersCount: 1},
	}

	report := buildTeamReport(tlID, from, to, rows)

	if report.TeamLeadID != tlID {
		t.Errorf("TeamLeadID mismatch")
	}
	if len(report.Members) != 3 {
		t.Errorf("Members count: got %d, want 3", len(report.Members))
	}
	if !near2i(report.TotalIncome, 40.0) {
		t.Errorf("TotalIncome: got %.2f, want 40.00 (8+2.4+8+21.6)", report.TotalIncome)
	}
	if !near2i(report.ByEventType["seller_commission_earned"], 16.0) {
		t.Errorf("team seller total: got %.2f, want 16.00", report.ByEventType["seller_commission_earned"])
	}
	if !near2i(report.ByEventType["team_lead_pool_earned"], 21.6) {
		t.Errorf("team pool: got %.2f, want 21.60", report.ByEventType["team_lead_pool_earned"])
	}
}

// ─── parsePeriod tests ────────────────────────────────────────────────────────

// TestParsePeriod_DefaultsToCurrentMonth verifies that empty strings yield the
// start of the current month (in loc) as the from date.
func TestParsePeriod_DefaultsToCurrentMonth(t *testing.T) {
	from, _, err := parsePeriod("", "", time.UTC)
	if err != nil {
		t.Fatalf("parsePeriod with empty strings failed: %v", err)
	}
	now := time.Now().UTC()
	if from.Year() != now.Year() || from.Month() != now.Month() || from.Day() != 1 {
		t.Errorf("default from should be start of current month, got %v", from)
	}
}

// TestParsePeriod_ParsesCorrectly verifies date string parsing.
func TestParsePeriod_ParsesCorrectly(t *testing.T) {
	from, to, err := parsePeriod("2026-06-01", "2026-06-30", time.UTC)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if from.Year() != 2026 || from.Month() != 6 || from.Day() != 1 {
		t.Errorf("from: got %v", from)
	}
	if to.Year() != 2026 || to.Month() != 6 || to.Day() != 30 {
		t.Errorf("to: got %v", to)
	}
	// to should include the full end day.
	if to.Hour() != 23 || to.Minute() != 59 {
		t.Errorf("to should be end of day, got %v", to)
	}
}

// TestParsePeriod_InvalidDateReturnsError verifies bad date strings are rejected.
func TestParsePeriod_InvalidDateReturnsError(t *testing.T) {
	_, _, err := parsePeriod("not-a-date", "", time.UTC)
	if err == nil {
		t.Error("expected error for invalid from date")
	}
	_, _, err = parsePeriod("", "2026/06/30", time.UTC) // wrong separator
	if err == nil {
		t.Error("expected error for invalid to date")
	}
}

// TestParsePeriod_InterpretsBareDateInBusinessTimezone verifies the fix for
// the "К выплате shows 0" bug: a bare YYYY-MM-DD "today" must be treated as
// midnight in the business timezone (e.g. Asia/Dushanbe, UTC+5), not UTC —
// otherwise an event recorded in the early hours of the local day (still
// "today" locally, but still "yesterday" in UTC) is silently excluded from
// the query window.
func TestParsePeriod_InterpretsBareDateInBusinessTimezone(t *testing.T) {
	dushanbe, err := time.LoadLocation("Asia/Dushanbe")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}

	from, to, err := parsePeriod("2026-07-23", "2026-07-23", dushanbe)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Local midnight 2026-07-23 00:00 +05:00 is 2026-07-22 19:00 UTC.
	wantFrom := time.Date(2026, 7, 22, 19, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) {
		t.Errorf("from: got %v, want %v", from, wantFrom)
	}

	// An event at 2026-07-23 00:23 local (2026-07-22 19:23 UTC) must fall
	// within [from, to] — this is exactly the order from the bug report.
	eventUTC := time.Date(2026, 7, 22, 19, 23, 0, 0, time.UTC)
	if eventUTC.Before(from) || eventUTC.After(to) {
		t.Errorf("event at %v should fall within [%v, %v]", eventUTC, from, to)
	}
}
