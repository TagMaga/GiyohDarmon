package teams

// service_test.go — IDOR scoping tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Each test
// runs inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/teams/ -v -run TestTeams

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

func alwaysExists(ctx context.Context, id uuid.UUID) (bool, error) { return true, nil }

func newTestService(db *gorm.DB) *Service {
	return NewService(NewRepository(db), alwaysExists)
}

func createTeam(t *testing.T, db *gorm.DB, name string, teamLeadID, managerID *uuid.UUID) *Team {
	t.Helper()
	team := &Team{ID: uuid.New(), Name: name, TeamLeadID: teamLeadID, ManagerID: managerID, IsActive: true}
	if err := db.Create(team).Error; err != nil {
		t.Fatalf("testutil: create team: %v", err)
	}
	return team
}

func notFoundCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestTeams_Owner_CanAccessAnyTeam(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	team := createTeam(t, db, "Team A", &lead.ID, nil)

	got, err := svc.GetByID(ctx, owner.ID, "owner", team.ID)
	if err != nil {
		t.Fatalf("owner GetByID: %v", err)
	}
	if got.ID != team.ID {
		t.Fatalf("got team %s, want %s", got.ID, team.ID)
	}

	list, _, err := svc.List(ctx, owner.ID, "owner", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("owner List: %v", err)
	}
	found := false
	for _, tm := range list {
		if tm.ID == team.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("owner's team list did not include the team")
	}
}

func TestTeams_TeamLead_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	leadA := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	leadB := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	teamA := createTeam(t, db, "Team Lead A's Team", &leadA.ID, nil)
	teamB := createTeam(t, db, "Team Lead B's Team", &leadB.ID, nil)

	// Own team: allowed.
	got, err := svc.GetByID(ctx, leadA.ID, "sales_team_lead", teamA.ID)
	if err != nil {
		t.Fatalf("own team GetByID: %v", err)
	}
	if got.ID != teamA.ID {
		t.Fatalf("got team %s, want own team %s", got.ID, teamA.ID)
	}

	// Another lead's team: denied, as NotFound (not Forbidden) to avoid
	// confirming the team's existence to a caller outside its scope.
	_, err = svc.GetByID(ctx, leadA.ID, "sales_team_lead", teamB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetByID to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	// List must not leak the other lead's team either.
	list, _, err := svc.List(ctx, leadA.ID, "sales_team_lead", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, tm := range list {
		if tm.ID == teamB.ID {
			t.Fatal("team lead's list leaked another team lead's team")
		}
	}
}

func TestTeams_Manager_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	managerA := testutil.CreateUser(t, db, users.RoleManager)
	managerB := testutil.CreateUser(t, db, users.RoleManager)
	teamA := createTeam(t, db, "Manager A's Team", nil, &managerA.ID)
	teamB := createTeam(t, db, "Manager B's Team", nil, &managerB.ID)

	got, err := svc.GetByID(ctx, managerA.ID, "manager", teamA.ID)
	if err != nil {
		t.Fatalf("own team GetByID: %v", err)
	}
	if got.ID != teamA.ID {
		t.Fatalf("got team %s, want own team %s", got.ID, teamA.ID)
	}

	_, err = svc.GetByID(ctx, managerA.ID, "manager", teamB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetByID to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	list, _, err := svc.List(ctx, managerA.ID, "manager", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, tm := range list {
		if tm.ID == teamB.ID {
			t.Fatal("manager's list leaked another manager's team")
		}
	}
}
