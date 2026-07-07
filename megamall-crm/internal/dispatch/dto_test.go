package dispatch

// dto_test.go — Pure unit test for the cash-handover amount max hardening.
//
// No database, no network required.

import (
	"testing"

	"github.com/megamall/crm/pkg/validator"
)

func TestConfirmHandoverRequest_AmountOverMaxRejected(t *testing.T) {
	req := ConfirmHandoverRequest{ActualReturned: 1_000_001}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected actual_returned over the max to be rejected")
	}
}

func TestConfirmHandoverRequest_AmountAtMaxAccepted(t *testing.T) {
	req := ConfirmHandoverRequest{ActualReturned: 1_000_000}
	if appErr := validator.Validate(req); appErr != nil {
		t.Fatalf("expected actual_returned at exactly the max to be accepted, got: %v", appErr)
	}
}
