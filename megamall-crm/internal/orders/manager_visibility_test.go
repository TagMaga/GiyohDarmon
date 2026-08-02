package orders

// manager_visibility_test.go — DB-backed regression coverage for the
// manager order-visibility bug: repository.List's role scope for "manager"
// is "manager_id = self OR seller_id = self" (managed team's orders +
// personal orders), but the frontend's manager pages also send manager_id
// as an explicit filter param for defense-in-depth. Before the fix, that
// filter was AND'd on top of the role scope, collapsing it down to
// "manager_id = self" only — silently hiding personal/self-authored orders
// whose manager_id doesn't happen to equal the viewer's own ID. This is the
// everyday shape of a promoted user's order history: an order they placed
// as a plain seller (manager_id = whoever managed their team back then)
// must still show up once they view it as a manager, because
// CanAccessOrder and the role scope both already allow seller_id = self
// unconditionally.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/orders/ -v -run TestManagerVisibility

import (
	"context"
	"testing"
	"time"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/pkg/pagination"
)

func TestManagerVisibility_OwnOrderWithForeignManagerID_StillListed(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	repo := NewRepository(db, time.UTC)

	// otherManagerID manages the team sellerID belonged to — a real,
	// different person from sellerID itself.
	otherManagerID, _, sellerID := setupTeamWithSeller(t, db, teamRepo, hierRepo)

	customerID, cityID, productID := setupOrderFixtures(t, db, sellerID)
	req := buildOrderRequest(customerID, cityID, productID) // seller_order
	order, err := svc.Create(context.Background(), sellerID, "seller", req)
	if err != nil {
		t.Fatalf("create seller order: %v", err)
	}
	if order.ManagerID == nil || *order.ManagerID != otherManagerID {
		t.Fatalf("test setup invariant broken: expected order.ManagerID = %s, got %v", otherManagerID, order.ManagerID)
	}

	// sellerID now views their own order history as if they were a manager
	// (mirrors a real promotion, or simply the manager role's frontend
	// pages sending manager_id=self as an extra filter alongside the
	// already-self-scoped role query). Their own past order — whose
	// manager_id is someone else entirely — must still be visible.
	filter := ListOrdersFilter{ManagerID: sellerID.String()}
	rows, _, err := repo.List(context.Background(), filter, sellerID, "manager", pagination.Params{Limit: 20})
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	found := false
	for _, r := range rows {
		if r.ID == order.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected own order (seller_id=self, manager_id=%s) to be listed when manager_id=self is also sent as a filter; got %d rows", otherManagerID, len(rows))
	}
}
