package courier_tariffs

// model_test.go — CourierTariffRule.Resolve bracket-matching (pure, no DB).
//
// Regression coverage for the bug where ResolveAssignmentPayout called
// ResolveCourierPayout with orderAmount=0 at assignment time: for a
// TariffFixed rule whose AmountFrom is 0 (the natural first bracket in any
// graduated schedule), Resolve(0) treats amount=0 as falling inside that
// bracket and returns its fixed payout — not "no match" — so every order
// silently got paid at the lowest tariff regardless of its real value. See
// internal/logistics_settings/resolve.go's ResolveAssignmentPayout doc
// comment for the full story; the actual fix was passing the order's real
// total_amount instead of 0, not a change to Resolve itself.

import "testing"

func TestCourierTariffRule_Resolve_ZeroAmountMatchesLowestFixedBracket(t *testing.T) {
	upper := 500.0
	rule := CourierTariffRule{AmountFrom: 0, AmountTo: &upper, TariffType: TariffFixed, TariffValue: 20}

	payout, matched := rule.Resolve(0)
	if !matched || payout != 20 {
		t.Fatalf("Resolve(0) = (%v, %v), want (20, true) — amount=0 falls inside [0,500) and must match its fixed payout, "+
			"which is exactly why callers must never pass 0 as a stand-in for \"unknown amount\"", payout, matched)
	}
}

func TestCourierTariffRule_Resolve_RealAmountPicksHigherBracket(t *testing.T) {
	rule := CourierTariffRule{AmountFrom: 2000, AmountTo: nil, TariffType: TariffFixed, TariffValue: 50}

	payout, matched := rule.Resolve(3000)
	if !matched || payout != 50 {
		t.Fatalf("Resolve(3000) = (%v, %v), want (50, true) for the 2000+ bracket", payout, matched)
	}

	payoutTooLow, matchedTooLow := rule.Resolve(100)
	if matchedTooLow {
		t.Fatalf("Resolve(100) = (%v, %v), want no match — 100 is below this bracket's AmountFrom of 2000", payoutTooLow, matchedTooLow)
	}
}

func TestCourierTariffRule_Resolve_PercentBracket(t *testing.T) {
	rule := CourierTariffRule{AmountFrom: 0, AmountTo: nil, TariffType: TariffPercent, TariffValue: 10}

	payout, matched := rule.Resolve(1000)
	if !matched || payout != 100 {
		t.Fatalf("Resolve(1000) = (%v, %v), want (100, true) for a 10%% bracket", payout, matched)
	}

	// This is the specific case that made the assignment-time bug easy to
	// miss for percent-type couriers: amount=0 still "matches" the bracket
	// (0 >= AmountFrom, 0 < AmountTo), but 10% of 0 is 0, so
	// ResolveCourierPayout's `if payout > 0` check happened to fall through
	// to the flat profile rate anyway — masking the bug rather than fixing
	// it. Fixed-type couriers had no such luck (see the zero-amount test
	// above): their nonzero fixed payout was returned immediately.
	zeroPayout, zeroMatched := rule.Resolve(0)
	if !zeroMatched || zeroPayout != 0 {
		t.Fatalf("Resolve(0) on a percent bracket = (%v, %v), want (0, true)", zeroPayout, zeroMatched)
	}
}
