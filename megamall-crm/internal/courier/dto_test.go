package courier

// dto_test.go — Pure unit test for the cash-handover amount max hardening.
//
// No database, no network required.

import (
	"testing"

	"github.com/megamall/crm/pkg/validator"
)

func TestSubmitHandoverRequest_AmountOverMaxRejected(t *testing.T) {
	tooHigh := 2_000_000.0
	req := SubmitHandoverRequest{ActualAmount: &tooHigh}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected actual_amount over the max to be rejected")
	}
}

func TestSubmitHandoverRequest_NoAmountAccepted(t *testing.T) {
	// Every field is optional — a courier can submit a handover before
	// stating the actual amount.
	req := SubmitHandoverRequest{}
	if appErr := validator.Validate(req); appErr != nil {
		t.Fatalf("expected an empty submission to be accepted, got: %v", appErr)
	}
}
