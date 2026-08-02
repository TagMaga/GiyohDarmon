package orders

// team_lead_visibility_test.go — DB-backed regression coverage for the team
// lead order-visibility bug: repository.List's role scope for
// "sales_team_lead" is "team_lead_id = self OR seller_id = self" (led
// team's orders + personal orders), but the frontend's team-lead pages also
// send team_lead_id as an explicit filter param for defense-in-depth.
// Before the fix, that filter was AND'd on top of the role scope,
// collapsing it down to "team_lead_id = self" only — silently hiding a team
// lead's own personal order whenever their user_hierarchy row still points
// at a team led by someone else (e.g. a team lead not yet re-assigned to
// their own team's lead slot). This is exactly why an order a team lead
// placed themselves showed up in the owner panel (no team_lead_id filter)
// but not in their own team-lead panel.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/orders/ -v -run TestTeamLeadVisibility

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/pkg/pagination"
)

func TestTeamLeadVisibility_OwnOrderWithForeignTeamLeadID_StillListed(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierRepo, teamRepo := buildTestOrderService(t, db)
	repo := NewRepository(db, time.UTC)

	// otherTeamLeadID leads a real, different team from actorID — actorID's
	// own hierarchy row is (mis)pointed at that team, mirroring a team lead
	// whose user_hierarchy hasn't been re-synced to their own team yet.
	_, otherTeamLeadID, _, otherTeamID := setupTeamWithSellerAndTeamID(t, db, teamRepo, hierRepo)

	actor := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	if err := hierRepo.Upsert(context.Background(), &hierarchy.UserHierarchy{
		ID: uuid.New(), UserID: actor.ID, TeamID: &otherTeamID,
	}); err != nil {
		t.Fatalf("assign actor hierarchy: %v", err)
	}

	customerID, cityID, productID := setupOrderFixtures(t, db, actor.ID)
	req := buildOrderRequest(customerID, cityID, productID)
	req.OrderType = OrderTypeTeamLeadPersonal
	order, err := svc.Create(context.Background(), actor.ID, "sales_team_lead", req)
	if err != nil {
		t.Fatalf("create team-lead personal order: %v", err)
	}
	if order.TeamLeadID == nil || *order.TeamLeadID != otherTeamLeadID {
		t.Fatalf("test setup invariant broken: expected order.TeamLeadID = %s, got %v", otherTeamLeadID, order.TeamLeadID)
	}

	// actor now views their own team-lead order list, with the frontend's
	// defense-in-depth team_lead_id=self filter also sent alongside the
	// already-self-scoped role query. Their own order — whose team_lead_id
	// is someone else entirely — must still be visible.
	filter := ListOrdersFilter{TeamLeadID: actor.ID.String()}
	rows, _, err := repo.List(context.Background(), filter, actor.ID, "sales_team_lead", pagination.Params{Limit: 20})
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
		t.Errorf("expected own order (seller_id=self, team_lead_id=%s) to be listed when team_lead_id=self is also sent as a filter; got %d rows", otherTeamLeadID, len(rows))
	}
}
