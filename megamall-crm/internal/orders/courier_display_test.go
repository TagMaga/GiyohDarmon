package orders

// courier_display_test.go — Unit tests for OrderResponse.applyCourierDisplay,
// the business rule that decides which courier (and label) the UI shows.
//
// Run with: go test ./internal/orders/ -v -run TestCourierDisplay

import (
	"testing"

	"github.com/google/uuid"
)

func strp(s string) *string { return &s }

// TestCourierDisplay_DeliveredWithInactiveAssignment is the headline case:
// a delivered order whose assignment is no longer active must STILL show the
// courier who delivered it — never "unassigned"/"Без курьера".
func TestCourierDisplay_DeliveredWithInactiveAssignment(t *testing.T) {
	courierID := uuid.New()
	r := OrderResponse{Status: StatusDelivered}
	info := CourierInfo{
		// No active assignment (it was deactivated), but the last assignment
		// records the courier who delivered.
		ActiveCourierID:   nil,
		ActiveCourierName: nil,
		LastCourierID:     &courierID,
		LastCourierName:   strp("Аличон"),
	}
	r.applyCourierDisplay(info, nil)

	if r.CourierDisplayStatus != "delivered_by" {
		t.Errorf("display_status: want delivered_by, got %q", r.CourierDisplayStatus)
	}
	if r.CourierDisplayName == nil || *r.CourierDisplayName != "Аличон" {
		t.Errorf("display_name: want Аличон, got %v", r.CourierDisplayName)
	}
	if r.DeliveredByCourierID == nil || *r.DeliveredByCourierID != courierID {
		t.Errorf("delivered_by_courier_id not set")
	}
}

// TestCourierDisplay_DeliveredFallbackToCache covers the deeper safety net:
// no assignment rows resolved a name, but orders.courier_id still points at a
// courier — we must expose that id and mark it delivered_by, not unassigned.
func TestCourierDisplay_DeliveredFallbackToCache(t *testing.T) {
	cache := uuid.New()
	r := OrderResponse{Status: StatusDelivered}
	r.applyCourierDisplay(CourierInfo{}, &cache)

	if r.CourierDisplayStatus != "delivered_by" {
		t.Errorf("want delivered_by from cache fallback, got %q", r.CourierDisplayStatus)
	}
	if r.DeliveredByCourierID == nil || *r.DeliveredByCourierID != cache {
		t.Errorf("delivered_by_courier_id should fall back to courier_id cache")
	}
}

// TestCourierDisplay_ActiveAssigned: a live assigned order shows the active courier.
func TestCourierDisplay_ActiveAssigned(t *testing.T) {
	cid := uuid.New()
	r := OrderResponse{Status: StatusAssigned}
	r.applyCourierDisplay(CourierInfo{ActiveCourierID: &cid, ActiveCourierName: strp("Аличон")}, nil)

	if r.CourierDisplayStatus != "assigned" {
		t.Errorf("want assigned, got %q", r.CourierDisplayStatus)
	}
	if r.CurrentCourierID == nil || *r.CurrentCourierID != cid {
		t.Errorf("current_courier_id not set for assigned order")
	}
	if r.CourierDisplayName == nil || *r.CourierDisplayName != "Аличон" {
		t.Errorf("display_name: want Аличон, got %v", r.CourierDisplayName)
	}
}

// TestCourierDisplay_ConfirmedUnassigned: a confirmed order with no courier is
// unassigned with no name — no regression for the normal unassigned case.
func TestCourierDisplay_ConfirmedUnassigned(t *testing.T) {
	r := OrderResponse{Status: StatusConfirmed}
	r.applyCourierDisplay(CourierInfo{}, nil)

	if r.CourierDisplayStatus != "unassigned" {
		t.Errorf("want unassigned, got %q", r.CourierDisplayStatus)
	}
	if r.CourierDisplayName != nil {
		t.Errorf("display_name should be nil for unassigned, got %v", *r.CourierDisplayName)
	}
	if r.CurrentCourierID != nil || r.DeliveredByCourierID != nil {
		t.Errorf("no courier ids should be set for an unassigned confirmed order")
	}
}

// TestCourierDisplay_InDeliveryActive: en-route order shows the active courier.
func TestCourierDisplay_InDeliveryActive(t *testing.T) {
	cid := uuid.New()
	r := OrderResponse{Status: StatusInDelivery}
	r.applyCourierDisplay(CourierInfo{ActiveCourierID: &cid, ActiveCourierName: strp("Аличон")}, nil)
	if r.CourierDisplayStatus != "assigned" || r.CourierDisplayName == nil {
		t.Errorf("in_delivery should show active courier as assigned, got status=%q name=%v",
			r.CourierDisplayStatus, r.CourierDisplayName)
	}
}
