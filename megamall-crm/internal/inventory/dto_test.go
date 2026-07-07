package inventory

// dto_test.go — Pure unit tests for inventory quantity validation hardening.
//
// No database, no network required. Run with: go test ./internal/inventory/ -v

import (
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/validator"
)

func TestCreateReceivingRequest_QuantityOverMaxRejected(t *testing.T) {
	req := CreateReceivingRequest{ProductID: uuid.New(), Quantity: 1_000_001, UnitCost: 10}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected quantity over the max to be rejected")
	}
}

func TestCreateReceivingRequest_QuantityAtMaxAccepted(t *testing.T) {
	req := CreateReceivingRequest{ProductID: uuid.New(), Quantity: 1_000_000, UnitCost: 10}
	if appErr := validator.Validate(req); appErr != nil {
		t.Fatalf("expected quantity at exactly the max to be accepted, got: %v", appErr)
	}
}

func TestCreateAdjustmentRequest_QuantityOverMaxRejected(t *testing.T) {
	req := CreateAdjustmentRequest{ProductID: uuid.New(), NewQuantity: 2_000_000, Reason: "audit correction"}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected new_quantity over the max to be rejected")
	}
}

func TestCreateWriteoffRequest_QuantityOverMaxRejected(t *testing.T) {
	req := CreateWriteoffRequest{ProductID: uuid.New(), Quantity: 5_000_000, Reason: "damaged stock"}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected write-off quantity over the max to be rejected")
	}
}
