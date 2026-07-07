package hierarchy

// service_test.go — IDOR scoping tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Each test
// runs inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/hierarchy/ -v -run TestHierarchy

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

// testTeam is a minimal stand-in for teams.Team, avoided as a direct import
// to keep this package's tests independent of internal/teams; it maps onto
// the same "teams" table.
type testTeam struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	Name       string     `gorm:"not null"`
	TeamLeadID *uuid.UUID `gorm:"type:uuid"`
	ManagerID  *uuid.UUID `gorm:"type:uuid"`
	IsActive   bool       `gorm:"default:true;not null"`
	DeletedAt  *time.Time `gorm:"index"`
}

func (testTeam) TableName() string { return "teams" }

func createTestTeam(t *testing.T, db *gorm.DB, name string, teamLeadID, managerID *uuid.UUID) uuid.UUID {
	t.Helper()
	tm := &testTeam{ID: uuid.New(), Name: name, TeamLeadID: teamLeadID, ManagerID: managerID, IsActive: true}
	if err := db.Create(tm).Error; err != nil {
		t.Fatalf("testutil: create team: %v", err)
	}
	return tm.ID
}

func alwaysExists(ctx context.Context, id uuid.UUID) (bool, error) { return true, nil }

func noBriefs(ctx context.Context, ids []uuid.UUID) ([]UserBrief, error) { return nil, nil }

// newTestService wires a hierarchy.Service against db, with teamBrief
// resolving directly from the "teams" table (mirrors how main.go wires the
// cross-module TeamBriefFn from the real teams module).
func newTestService(db *gorm.DB) *Service {
	teamBrief := func(ctx context.Context, id uuid.UUID) (*TeamBrief, error) {
		var tm testTeam
		err := db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&tm).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &TeamBrief{ID: tm.ID, Name: tm.Name, TeamLeadID: tm.TeamLeadID, ManagerID: tm.ManagerID}, nil
	}
	return NewService(NewRepository(db), alwaysExists, alwaysExists, noBriefs, teamBrief)
}

func assignToTeam(t *testing.T, db *gorm.DB, svc *Service, userID uuid.UUID, teamID *uuid.UUID) {
	t.Helper()
	if _, err := svc.Assign(context.Background(), AssignRequest{UserID: userID, TeamID: teamID}); err != nil {
		t.Fatalf("assign hierarchy: %v", err)
	}
}

func notFoundCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestHierarchy_Owner_CanAccessAnyTeam(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	member := testutil.CreateUser(t, db, users.RoleSeller)
	teamID := createTestTeam(t, db, "Team A", &lead.ID, nil)
	assignToTeam(t, db, svc, member.ID, &teamID)

	members, err := svc.GetTeamMembers(ctx, owner.ID, "owner", teamID)
	if err != nil {
		t.Fatalf("owner GetTeamMembers: %v", err)
	}
	found := false
	for _, m := range members {
		if m.UserID == member.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("owner's team-members query did not include the member")
	}

	chain, err := svc.GetUserChain(ctx, owner.ID, "owner", member.ID)
	if err != nil {
		t.Fatalf("owner GetUserChain: %v", err)
	}
	if len(chain) == 0 || chain[0].UserID != member.ID {
		t.Fatal("owner's chain query did not return the target user")
	}
}

func TestHierarchy_TeamLead_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	leadA := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	leadB := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	memberB := testutil.CreateUser(t, db, users.RoleSeller)
	teamB := createTestTeam(t, db, "Team B", &leadB.ID, nil)
	assignToTeam(t, db, svc, memberB.ID, &teamB)

	_, err := svc.GetTeamMembers(ctx, leadA.ID, "sales_team_lead", teamB)
	if err == nil {
		t.Fatal("expected cross-team GetTeamMembers to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	_, err = svc.GetUserChain(ctx, leadA.ID, "sales_team_lead", memberB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetUserChain to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

func TestHierarchy_Manager_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	managerA := testutil.CreateUser(t, db, users.RoleManager)
	managerB := testutil.CreateUser(t, db, users.RoleManager)
	memberB := testutil.CreateUser(t, db, users.RoleSeller)
	teamB := createTestTeam(t, db, "Manager B's Team", nil, &managerB.ID)
	assignToTeam(t, db, svc, memberB.ID, &teamB)

	_, err := svc.GetTeamMembers(ctx, managerA.ID, "manager", teamB)
	if err == nil {
		t.Fatal("expected cross-team GetTeamMembers to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	_, err = svc.GetUserChain(ctx, managerA.ID, "manager", memberB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetUserChain to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

// TestHierarchy_Seller_GlobalAccessDenied documents the route-level gate
// (RegisterRoutes only allows owner/sales_team_lead/manager on
// /hierarchy/user/:user_id and /hierarchy/team/:team_id/members — seller is
// restricted to /hierarchy/my-team, which is self-scoped via claims.TeamID).
// This test exercises the service directly to show a seller is never even a
// recognized case in the scoping switch, so if the route gate were ever
// loosened, sellers would still be denied by canAccessTeam's default branch.
func TestHierarchy_Seller_GlobalAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	seller := testutil.CreateUser(t, db, users.RoleSeller)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	teamID := createTestTeam(t, db, "Some Team", &lead.ID, nil)

	_, err := svc.GetTeamMembers(ctx, seller.ID, "seller", teamID)
	if err == nil {
		t.Fatal("expected seller's global hierarchy access to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}

// TestHierarchy_GetTeamMembers_ExcludesDeactivatedAndDeleted covers the
// soft-delete hierarchy cleanup requirement: a deactivated or deleted member
// must not remain visible in a team roster (internal/hierarchy/repository.go:
// GetByTeamID joins against users and filters is_active/deleted_at).
func TestHierarchy_GetTeamMembers_ExcludesDeactivatedAndDeleted(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	usersSvc := users.NewService(users.NewRepository(db))
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	active := testutil.CreateUser(t, db, users.RoleSeller)
	deactivated := testutil.CreateUser(t, db, users.RoleSeller)
	deleted := testutil.CreateUser(t, db, users.RoleSeller)
	teamID := createTestTeam(t, db, "Roster Team", &lead.ID, nil)
	assignToTeam(t, db, svc, active.ID, &teamID)
	assignToTeam(t, db, svc, deactivated.ID, &teamID)
	assignToTeam(t, db, svc, deleted.ID, &teamID)

	inactive := false
	if _, err := usersSvc.Update(ctx, deactivated.ID, users.UpdateUserRequest{IsActive: &inactive}); err != nil {
		t.Fatalf("deactivate user: %v", err)
	}
	if err := usersSvc.Delete(ctx, deleted.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	members, err := svc.GetTeamMembers(ctx, owner.ID, "owner", teamID)
	if err != nil {
		t.Fatalf("owner GetTeamMembers: %v", err)
	}
	seen := map[uuid.UUID]bool{}
	for _, m := range members {
		seen[m.UserID] = true
	}
	if !seen[active.ID] {
		t.Fatal("expected active member to be included in the roster")
	}
	if seen[deactivated.ID] {
		t.Fatal("expected deactivated member to be excluded from the roster")
	}
	if seen[deleted.ID] {
		t.Fatal("expected deleted member to be excluded from the roster")
	}
}

// TestHierarchy_DeletedTeam_Hidden covers the soft-delete hierarchy cleanup
// requirement: once a team is deleted, its roster must no longer be
// reachable through hierarchy endpoints, for any caller including owner.
func TestHierarchy_DeletedTeam_Hidden(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	teamID := createTestTeam(t, db, "Soon Deleted Team", &lead.ID, nil)

	if err := db.Exec(`UPDATE teams SET deleted_at = NOW() WHERE id = ?`, teamID).Error; err != nil {
		t.Fatalf("soft delete team: %v", err)
	}

	if _, err := svc.GetMyTeam(ctx, teamID); err == nil {
		t.Fatal("expected GetMyTeam to hide a deleted team")
	} else if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	if _, err := svc.GetTeamMembers(ctx, owner.ID, "owner", teamID); err == nil {
		t.Fatal("expected owner's GetTeamMembers to hide a deleted team")
	} else if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}
}
