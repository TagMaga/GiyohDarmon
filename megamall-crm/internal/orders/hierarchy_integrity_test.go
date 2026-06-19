package orders

// hierarchy_integrity_test.go — Pure unit tests for Phase 26 order hierarchy hardening.
//
// Verifies that:
//   1. orders.manager_id, team_lead_id, manager_team_id, team_lead_team_id are
//      *uuid.UUID (nullable) — orders created without a full hierarchy have NULL here.
//   2. orders.seller_id is uuid.UUID (NOT NULL value type) — every order has a seller.
//   3. The nullable hierarchy fields can be nil without causing a panic — the zero
//      value of *uuid.UUID is nil, which maps to SQL NULL and is valid.
//   4. A non-nil hierarchy value is preserved correctly when assigned (round-trip).
//
// No database, no network required.
// Run with: go test ./internal/orders/ -v -run TestHierarchy

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// ─── Field type assertions ────────────────────────────────────────────────────

// TestHierarchyIntegrity_SellerIDIsNotPointer confirms seller_id is NOT NULL at the
// model level — every order must have a seller.
func TestHierarchyIntegrity_SellerIDIsNotPointer(t *testing.T) {
	ft, ok := reflect.TypeOf(Order{}).FieldByName("SellerID")
	if !ok {
		t.Fatal("Order has no SellerID field")
	}
	if ft.Type.Kind() == reflect.Ptr {
		t.Errorf("Order.SellerID must be uuid.UUID (NOT NULL), got %s", ft.Type)
	}
}

// TestHierarchyIntegrity_HierarchyFieldsArePointers confirms the four hierarchy
// columns are *uuid.UUID (nullable) so orders without a full org hierarchy are valid.
func TestHierarchyIntegrity_HierarchyFieldsArePointers(t *testing.T) {
	nullable := []string{"ManagerID", "TeamLeadID", "ManagerTeamID", "TeamLeadTeamID"}
	wantKind := reflect.Ptr
	wantElem := reflect.TypeOf(uuid.UUID{})

	for _, name := range nullable {
		ft, ok := reflect.TypeOf(Order{}).FieldByName(name)
		if !ok {
			t.Errorf("Order has no %s field", name)
			continue
		}
		if ft.Type.Kind() != wantKind {
			t.Errorf(
				"Order.%s must be *uuid.UUID (nullable) for orders without a full hierarchy, got %s",
				name, ft.Type,
			)
			continue
		}
		if ft.Type.Elem() != wantElem {
			t.Errorf("Order.%s element type = %s, want %s", name, ft.Type.Elem(), wantElem)
		}
	}
}

// ─── Nil-safety assertions ─────────────────────────────────────────────────────

// TestHierarchyIntegrity_NilHierarchyIsValid confirms that an Order with all
// hierarchy fields nil (the zero value) is valid — this represents a seller-only
// order with no manager or team assigned.
func TestHierarchyIntegrity_NilHierarchyIsValid(t *testing.T) {
	o := Order{
		SellerID: uuid.New(),
		// ManagerID, TeamLeadID, ManagerTeamID, TeamLeadTeamID all nil (zero value)
	}

	if o.ManagerID != nil {
		t.Errorf("expected ManagerID nil for hierarchy-less order, got %v", o.ManagerID)
	}
	if o.TeamLeadID != nil {
		t.Errorf("expected TeamLeadID nil for hierarchy-less order, got %v", o.TeamLeadID)
	}
	if o.ManagerTeamID != nil {
		t.Errorf("expected ManagerTeamID nil for hierarchy-less order, got %v", o.ManagerTeamID)
	}
	if o.TeamLeadTeamID != nil {
		t.Errorf("expected TeamLeadTeamID nil for hierarchy-less order, got %v", o.TeamLeadTeamID)
	}
}

// TestHierarchyIntegrity_SetHierarchyRoundTrip confirms that assigning a non-nil
// value to each hierarchy field is preserved correctly (no silent truncation/overwrite).
func TestHierarchyIntegrity_SetHierarchyRoundTrip(t *testing.T) {
	managerID     := uuid.New()
	teamLeadID    := uuid.New()
	managerTeamID := uuid.New()
	tlTeamID      := uuid.New()

	o := Order{
		SellerID:       uuid.New(),
		ManagerID:      &managerID,
		TeamLeadID:     &teamLeadID,
		ManagerTeamID:  &managerTeamID,
		TeamLeadTeamID: &tlTeamID,
	}

	if o.ManagerID == nil || *o.ManagerID != managerID {
		t.Errorf("ManagerID round-trip failed: got %v, want %v", o.ManagerID, managerID)
	}
	if o.TeamLeadID == nil || *o.TeamLeadID != teamLeadID {
		t.Errorf("TeamLeadID round-trip failed: got %v, want %v", o.TeamLeadID, teamLeadID)
	}
	if o.ManagerTeamID == nil || *o.ManagerTeamID != managerTeamID {
		t.Errorf("ManagerTeamID round-trip failed: got %v, want %v", o.ManagerTeamID, managerTeamID)
	}
	if o.TeamLeadTeamID == nil || *o.TeamLeadTeamID != tlTeamID {
		t.Errorf("TeamLeadTeamID round-trip failed: got %v, want %v", o.TeamLeadTeamID, tlTeamID)
	}
}

// ─── SQL verification documentation ──────────────────────────────────────────
//
// After running migration 00037 on a live database, verify with:
//
//   -- 1. Confirm all four constraints use ON DELETE RESTRICT (confdeltype = 'r'):
//   SELECT conname, confdeltype
//   FROM pg_constraint
//   WHERE conrelid = 'orders'::regclass
//     AND contype = 'f'
//     AND conname IN (
//       'orders_manager_id_fkey',
//       'orders_team_lead_id_fkey',
//       'orders_manager_team_id_fkey',
//       'orders_team_lead_team_id_fkey'
//     );
//   -- Expected: 4 rows, all with confdeltype = 'r'
//
//   -- 2. Columns remain nullable (attnotnull = false):
//   SELECT attname, attnotnull
//   FROM pg_attribute
//   WHERE attrelid = 'orders'::regclass
//     AND attname IN ('manager_id','team_lead_id','manager_team_id','team_lead_team_id');
//   -- Expected: all attnotnull = false
//
//   -- 3. ON DELETE RESTRICT fires for user referenced by an order:
//   DELETE FROM users WHERE id = '<manager_id from any order>';
//   -- Expected: ERROR: update or delete on table "users" violates foreign key
//   --           constraint "orders_manager_id_fkey" on table "orders"
//
//   -- 4. Soft-delete (setting deleted_at) is still allowed:
//   UPDATE users SET deleted_at = NOW() WHERE id = '<manager_id>';
//   -- Expected: UPDATE 1  (no FK violation — deleted_at is not the PK)
