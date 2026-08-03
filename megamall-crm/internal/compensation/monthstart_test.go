package compensation

// monthstart_test.go — GetSellerTeamRank's "this month" window must start at
// midnight on the 1st in the business timezone.
//
// It previously used date_trunc('month', now()) in SQL. The DSN pins the
// Postgres session to UTC (TimeZone=UTC), so that evaluated to UTC month
// start — five hours late for Asia/Dushanbe. Commissions earned between
// 00:00 and 05:00 local on the 1st are still the *previous* month in UTC, so
// they dropped out of the ranking. Computing the bound in Go against s.loc
// makes it independent of the session timezone.
//
// Run with: go test ./internal/compensation/ -v -run TestMonthStart

import (
	"testing"
	"time"
)

func TestMonthStart_UsesBusinessTimezoneNotUTC(t *testing.T) {
	dushanbe, err := time.LoadLocation("Asia/Dushanbe")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	s := &Service{loc: dushanbe}

	// 02:00 on 1 September in Dushanbe — still 21:00 on 31 August in UTC.
	// The month must start on 1 September local (= 31 Aug 19:00 UTC), so an
	// event recorded at this instant falls *inside* the window.
	now := time.Date(2026, 9, 1, 2, 0, 0, 0, dushanbe)
	got := s.monthStart(now)

	want := time.Date(2026, 8, 31, 19, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("monthStart = %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
	if !got.Before(now) {
		t.Errorf("monthStart %s must precede %s — an event in the first local hours of the 1st would be excluded",
			got.Format(time.RFC3339), now.Format(time.RFC3339))
	}

	// The old UTC-based behaviour would have produced 1 Sept 00:00 UTC, which
	// is *after* `now` and would have dropped the event.
	utcMonthStart := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	if got.Equal(utcMonthStart) {
		t.Error("monthStart fell back to UTC month start — the bug this guards against")
	}
}

func TestMonthStart_MidMonthAndNilLoc(t *testing.T) {
	dushanbe, err := time.LoadLocation("Asia/Dushanbe")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}

	// Mid-month is unambiguous: 15 Aug local -> 1 Aug 00:00 +05 == 31 Jul 19:00 UTC.
	got := (&Service{loc: dushanbe}).monthStart(time.Date(2026, 8, 15, 13, 30, 0, 0, dushanbe))
	want := time.Date(2026, 7, 31, 19, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("monthStart = %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}

	// A nil loc must degrade to UTC rather than panic.
	gotUTC := (&Service{loc: nil}).monthStart(time.Date(2026, 8, 15, 13, 30, 0, 0, time.UTC))
	wantUTC := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	if !gotUTC.Equal(wantUTC) {
		t.Errorf("nil-loc monthStart = %s, want %s", gotUTC.Format(time.RFC3339), wantUTC.Format(time.RFC3339))
	}
}
