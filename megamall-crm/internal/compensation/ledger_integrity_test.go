package compensation

// ledger_integrity_test.go — Pure unit tests for Phase 25 ledger integrity hardening.
//
// Verifies that:
//   1. FinancialEvent.OrderID is a value type (not a pointer), enforcing the
//      NOT NULL constraint at the Go model level.
//   2. The zero UUID is distinguishable from a valid UUID — any row with a zero
//      UUID order_id will be rejected by the DB FK constraint.
//   3. EventListResponse.OrderID is also a value type (consistent API contract).
//   4. toEventListResponse correctly propagates OrderID from model to DTO.
//
// No database, no network required.
// Run with: go test ./internal/compensation/ -v -run TestLedger

import (
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ─── Model field type assertions ─────────────────────────────────────────────

// TestLedgerIntegrity_OrderIDIsNotPointer verifies that FinancialEvent.OrderID
// is uuid.UUID (value type), not *uuid.UUID (pointer/nullable).
//
// This is the code-level mirror of the NOT NULL DB constraint added in
// migration 00036. If this test fails, the model has regressed to nullable.
func TestLedgerIntegrity_OrderIDIsNotPointer(t *testing.T) {
	var e FinancialEvent
	ft, ok := reflect.TypeOf(e).FieldByName("OrderID")
	if !ok {
		t.Fatal("FinancialEvent has no OrderID field")
	}

	if ft.Type.Kind() == reflect.Ptr {
		t.Errorf(
			"FinancialEvent.OrderID must be uuid.UUID (value type), got %s — "+
				"pointer means nullable, which violates Phase 25 NOT NULL constraint",
			ft.Type,
		)
	}

	wantType := reflect.TypeOf(uuid.UUID{})
	if ft.Type != wantType {
		t.Errorf("FinancialEvent.OrderID type = %s, want %s", ft.Type, wantType)
	}
}

// TestLedgerIntegrity_EventListResponseOrderIDIsNotPointer mirrors the model
// check for the API DTO. The JSON response must never include "order_id": null.
func TestLedgerIntegrity_EventListResponseOrderIDIsNotPointer(t *testing.T) {
	var r EventListResponse
	ft, ok := reflect.TypeOf(r).FieldByName("OrderID")
	if !ok {
		t.Fatal("EventListResponse has no OrderID field")
	}

	if ft.Type.Kind() == reflect.Ptr {
		t.Errorf(
			"EventListResponse.OrderID must be uuid.UUID (value type), got %s — "+
				"pointer means the API can return null order_id, which violates Phase 25",
			ft.Type,
		)
	}
}

// ─── toEventListResponse conversion ─────────────────────────────────────────

// TestLedgerIntegrity_ToEventListResponse verifies the model→DTO converter
// correctly propagates a non-zero OrderID without losing the value.
func TestLedgerIntegrity_ToEventListResponse(t *testing.T) {
	orderID := uuid.New()
	snapID := uuid.New()
	userID := uuid.New()

	e := FinancialEvent{
		ID:        uuid.New(),
		OrderID:   orderID,
		SnapshotID: &snapID,
		EventType: EventSellerCommissionEarned,
		UserID:    &userID,
		Amount:    123.45,
		CreatedAt: time.Now(),
	}

	got := toEventListResponse(e)

	if got.OrderID != orderID {
		t.Errorf("OrderID = %s, want %s", got.OrderID, orderID)
	}
	if got.SnapshotID == nil || *got.SnapshotID != snapID {
		t.Errorf("SnapshotID mismatch")
	}
	if got.EventType != EventSellerCommissionEarned {
		t.Errorf("EventType = %s, want %s", got.EventType, EventSellerCommissionEarned)
	}
	if got.Amount != 123.45 {
		t.Errorf("Amount = %.2f, want 123.45", got.Amount)
	}
}

// ─── Zero UUID guard ──────────────────────────────────────────────────────────

// TestLedgerIntegrity_ZeroUUIDIsDistinguishable confirms that the zero value of
// uuid.UUID is not a valid order ID — it is all zeros, which will fail the DB
// FK constraint (orders table has no row with id = 00000000-0000-0000-0000-000000000000).
//
// This test documents the failure mode: if a caller forgets to set OrderID,
// the Go zero value propagates to the DB, which returns a FK violation error
// rather than silently inserting a NULL (the old behaviour).
func TestLedgerIntegrity_ZeroUUIDIsDistinguishable(t *testing.T) {
	var zero uuid.UUID
	generated := uuid.New()

	if zero == generated {
		t.Fatal("uuid.New() returned the zero UUID — RNG broken")
	}

	// Confirm zero UUID is all-zero bytes (the DB FK will reject it).
	for i, b := range zero {
		if b != 0 {
			t.Errorf("zero UUID byte[%d] = %d, want 0", i, b)
		}
	}
}

// ─── SQL verification documentation ─────────────────────────────────────────
//
// After running migration 00036 on a live database, verify with:
//
//   -- 1. No NULL order_id rows:
//   SELECT COUNT(*) FROM financial_events WHERE order_id IS NULL;
//   -- Expected: 0
//
//   -- 2. NOT NULL constraint is active:
//   INSERT INTO financial_events (id, order_id, event_type, amount)
//     VALUES (gen_random_uuid(), NULL, 'company_revenue_earned', 1.00);
//   -- Expected: ERROR: null value in column "order_id" violates not-null constraint
//
//   -- 3. ON DELETE RESTRICT is active:
//   DELETE FROM orders WHERE id = '<any order with financial events>';
//   -- Expected: ERROR: update or delete on table "orders" violates foreign key
//   --           constraint "fk_financial_events_order_strict" on table "financial_events"
//
//   -- 4. New FK name in pg_constraint:
//   SELECT conname, confdeltype FROM pg_constraint
//     WHERE conname = 'fk_financial_events_order_strict';
//   -- Expected: confdeltype = 'r'  (RESTRICT)
//
//   -- 5. Old FK is gone:
//   SELECT COUNT(*) FROM pg_constraint
//     WHERE conname = 'fk_financial_events_order';
//   -- Expected: 0
