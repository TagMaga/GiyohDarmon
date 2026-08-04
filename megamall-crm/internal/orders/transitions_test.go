package orders

// transitions_test.go — Pure unit tests for the order status state machine.
//
// The status set is fully connected: every status can transition to every
// other status ("all restorable" — no dead ends, e.g. a delivered or
// cancelled order can be moved back into active delivery to fix a mistake).
// validateTransitionRole is the real gate on who may perform a given move;
// these tests lock the graph shape and the role gate's edge cases.
//
// Run with: go test ./internal/orders/ -v -run TestTransition

import (
	"testing"

	"github.com/google/uuid"
)

// TestTransition_FullyConnected asserts every status can reach every other
// status directly.
func TestTransition_FullyConnected(t *testing.T) {
	for _, from := range allStatuses {
		for _, to := range allStatuses {
			if from == to {
				continue
			}
			if !CanTransition(from, to) {
				t.Errorf("expected %s → %s to be a valid transition, but it was rejected", from, to)
			}
		}
	}
}

// TestTransition_NoSelfLoop documents that a status cannot transition to itself.
func TestTransition_NoSelfLoop(t *testing.T) {
	for _, s := range allStatuses {
		if CanTransition(s, s) {
			t.Errorf("%s → %s must not be a valid state-machine transition", s, s)
		}
	}
}

// TestTransition_CourierScopedToOwnOrder locks down which transitions a
// courier may perform, and only on their own assigned order.
func TestTransition_CourierScopedToOwnOrder(t *testing.T) {
	courierID := uuid.New()
	otherCourierID := uuid.New()
	svc := &Service{}

	allowed := [][2]OrderStatus{
		{StatusAssigned, StatusInDelivery},
		{StatusInDelivery, StatusDelivered},
		{StatusInDelivery, StatusCancelled},
		{StatusAssigned, StatusConfirmed},
		{StatusInDelivery, StatusConfirmed},
	}
	for _, step := range allowed {
		order := &Order{Status: step[0], CourierID: &courierID}
		if err := svc.validateTransitionRole("courier", courierID, order, step[0], step[1]); err != nil {
			t.Errorf("assigned courier should be able to move %s → %s: %v", step[0], step[1], err)
		}
		if err := svc.validateTransitionRole("courier", otherCourierID, order, step[0], step[1]); err == nil {
			t.Errorf("another courier must not be able to move %s → %s", step[0], step[1])
		}
	}

	// Backward/unrelated moves stay dispatcher/owner-only.
	order := &Order{Status: StatusDelivered, CourierID: &courierID}
	if err := svc.validateTransitionRole("courier", courierID, order, StatusDelivered, StatusInDelivery); err == nil {
		t.Fatal("courier must not be able to reopen a delivered order")
	}
}

// TestTransition_RestoreCancelledScopedToOwnOrderOrTeam locks down who may
// move a cancelled order back to confirmed: seller/manager/sales_team_lead
// are scoped to their own order or own team, same as CanAccessOrder.
func TestTransition_RestoreCancelledScopedToOwnOrderOrTeam(t *testing.T) {
	svc := &Service{}
	sellerID := uuid.New()
	managerID := uuid.New()
	teamLeadID := uuid.New()
	strangerID := uuid.New()

	order := &Order{
		Status:     StatusCancelled,
		SellerID:   sellerID,
		ManagerID:  &managerID,
		TeamLeadID: &teamLeadID,
	}

	allowed := []struct {
		role  string
		actor uuid.UUID
	}{
		{"seller", sellerID},
		{"manager", sellerID},
		{"manager", managerID},
		{"sales_team_lead", sellerID},
		{"sales_team_lead", teamLeadID},
	}
	for _, c := range allowed {
		if err := svc.validateTransitionRole(c.role, c.actor, order, StatusCancelled, StatusConfirmed); err != nil {
			t.Errorf("%s should be able to restore this order: %v", c.role, err)
		}
	}

	denied := []struct {
		role  string
		actor uuid.UUID
	}{
		{"seller", strangerID},
		{"manager", strangerID},
		{"sales_team_lead", strangerID},
	}
	for _, c := range denied {
		if err := svc.validateTransitionRole(c.role, c.actor, order, StatusCancelled, StatusConfirmed); err == nil {
			t.Errorf("%s (stranger) must not be able to restore this order", c.role)
		}
	}
}

// TestTransition_DeliveredIsRestorable confirms the "all restorable"
// requirement: even the delivered/cancelled outcome statuses can be moved
// back into active delivery.
func TestTransition_DeliveredIsRestorable(t *testing.T) {
	cases := [][2]OrderStatus{
		{StatusDelivered, StatusInDelivery},
		{StatusCancelled, StatusNew},
		{StatusReturned, StatusConfirmed},
	}
	for _, c := range cases {
		if !CanTransition(c[0], c[1]) {
			t.Errorf("expected outcome status %s to be restorable to %s", c[0], c[1])
		}
	}
}
