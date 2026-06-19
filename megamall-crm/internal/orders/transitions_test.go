package orders

// transitions_test.go — Pure unit tests for the order status state machine.
//
// Focus: the backward "recall / unassign" edges added as part of the C1 fix
// (zombie orders). When an order moves backward into `confirmed`, the service
// layer releases the courier assignment; the state machine must therefore PERMIT
// these transitions. These tests lock that contract. No database required.
//
// Run with: go test ./internal/orders/ -v -run TestTransition

import "testing"

// TestTransition_BackwardRecallEdges asserts the recovery transitions a dispatcher
// relies on are valid. Each of these triggers assignment release in ChangeStatus.
func TestTransition_BackwardRecallEdges(t *testing.T) {
	cases := []struct {
		name string
		from OrderStatus
		to   OrderStatus
	}{
		{"issue → confirmed (resolve issue)", StatusIssue, StatusConfirmed},
		{"assigned → confirmed (unassign)", StatusAssigned, StatusConfirmed},
		{"in_delivery → confirmed (recall)", StatusInDelivery, StatusConfirmed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if !CanTransition(c.from, c.to) {
				t.Fatalf("expected %s → %s to be a valid transition, but it was rejected", c.from, c.to)
			}
		})
	}
}

// TestTransition_TerminalStatesStayClosed guards against accidentally opening
// transitions out of terminal states while editing the map.
func TestTransition_TerminalStatesStayClosed(t *testing.T) {
	terminals := []OrderStatus{StatusDelivered, StatusReturned, StatusCancelled}
	allTargets := []OrderStatus{
		StatusNew, StatusConfirmed, StatusPrepaymentPending, StatusPrepaymentReceived,
		StatusAssigned, StatusInDelivery, StatusIssue, StatusDelivered, StatusReturned, StatusCancelled,
	}
	for _, from := range terminals {
		if !from.IsTerminal() {
			t.Fatalf("%s should be terminal", from)
		}
		for _, to := range allTargets {
			if CanTransition(from, to) {
				t.Errorf("terminal %s must not transition to %s", from, to)
			}
		}
	}
}

// TestTransition_ForwardHappyPathIntact ensures the recall edges did not disturb
// the normal forward delivery lifecycle.
func TestTransition_ForwardHappyPathIntact(t *testing.T) {
	forward := [][2]OrderStatus{
		{StatusNew, StatusConfirmed},
		{StatusConfirmed, StatusAssigned},
		{StatusAssigned, StatusInDelivery},
		{StatusInDelivery, StatusDelivered},
	}
	for _, step := range forward {
		if !CanTransition(step[0], step[1]) {
			t.Errorf("forward lifecycle broken: %s → %s should be valid", step[0], step[1])
		}
	}
}

// TestTransition_NoSelfLoopToConfirmed documents that a plain confirmed order
// cannot transition to itself (the Unassign service guard handles the
// "nothing to unassign" case with a clear 400 instead).
func TestTransition_NoSelfLoopToConfirmed(t *testing.T) {
	if CanTransition(StatusConfirmed, StatusConfirmed) {
		t.Fatal("confirmed → confirmed must not be a valid state-machine transition")
	}
}
